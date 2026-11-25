import fs from 'node:fs';
import path from 'node:path';

export interface PreparedStatement {
  run: (...params: unknown[]) => void;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

export interface DbAdapter {
  exec: (sql: string) => void;
  prepare: (sql: string) => PreparedStatement;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'relaylane.db');

async function createDatabaseAdapter(): Promise<DbAdapter> {
  try {
    const sqlite = await import('node:sqlite');
    const nativeDb = new sqlite.DatabaseSync(DB_PATH);
    nativeDb.exec('PRAGMA journal_mode = WAL;');
    nativeDb.exec('PRAGMA foreign_keys = ON;');
    return nativeDb as unknown as DbAdapter;
  } catch {
    const { default: initSqlJs } = await import('sql.js');
    const SQL = await initSqlJs();
    const initialBuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : undefined;
    const wasmDb = initialBuffer ? new SQL.Database(initialBuffer) : new SQL.Database();
    wasmDb.run('PRAGMA foreign_keys = ON;');

    const persist = () => {
      const exported = wasmDb.export();
      fs.writeFileSync(DB_PATH, Buffer.from(exported));
    };

    const normalizeParams = (params: unknown[]): Array<string | number | null | Uint8Array> =>
      params.map((p) => {
        if (p === undefined || p === null) return null;
        if (typeof p === 'boolean') return p ? 1 : 0;
        if (typeof p === 'string' || typeof p === 'number' || p instanceof Uint8Array) return p;
        return String(p);
      });

    return {
      exec(sql: string) {
        wasmDb.run(sql);
        persist();
      },
      prepare(sql: string): PreparedStatement {
        return {
          run(...params: unknown[]) {
            const stmt = wasmDb.prepare(sql);
            try {
              stmt.bind(normalizeParams(params));
              stmt.step();
            } finally {
              stmt.free();
            }
            persist();
          },
          get(...params: unknown[]) {
            const stmt = wasmDb.prepare(sql);
            try {
              stmt.bind(normalizeParams(params));
              return stmt.step() ? stmt.getAsObject() : undefined;
            } finally {
              stmt.free();
            }
          },
          all(...params: unknown[]) {
            const stmt = wasmDb.prepare(sql);
            const rows: unknown[] = [];
            try {
              stmt.bind(normalizeParams(params));
              while (stmt.step()) {
                rows.push(stmt.getAsObject());
              }
            } finally {
              stmt.free();
            }
            return rows;
          },
        };
      },
    };
  }
}

export const db: DbAdapter = await createDatabaseAdapter();

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    industry TEXT NOT NULL,
    tier TEXT NOT NULL,
    primary_domain TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('INTERNAL_ADMIN', 'PROJECT_MANAGER', 'CLIENT_USER')),
    tenant_id TEXT NOT NULL,
    allowed_tenants_json TEXT NOT NULL,
    password_hash TEXT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS project_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    estimated_days INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS template_tasks (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('INTERNAL', 'CLIENT')),
    client_visible INTEGER NOT NULL DEFAULT 1,
    day_offset INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    depends_on_orders_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (template_id) REFERENCES project_templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    template_id TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    start_date TEXT NOT NULL,
    target_go_live TEXT NOT NULL,
    lead_pm_id TEXT NOT NULL,
    lead_pm_name TEXT NOT NULL,
    health TEXT NOT NULL CHECK (health IN ('ON_TRACK', 'AT_RISK', 'DELAYED')),
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED')),
    owner_type TEXT NOT NULL CHECK (owner_type IN ('INTERNAL', 'CLIENT')),
    assignee_name TEXT NOT NULL,
    assignee_role TEXT NOT NULL,
    client_visible INTEGER NOT NULL DEFAULT 1,
    due_date TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(task_id, depends_on_task_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    project_id TEXT,
    task_id TEXT,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    event_type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    entity_label TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_tenant_project ON tasks(tenant_id, project_id);
  CREATE INDEX IF NOT EXISTS idx_deps_tenant_task ON task_dependencies(tenant_id, task_id);
  CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);
`);

export function seedDatabaseIfEmpty(): void {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM tenants').get() as { cnt: number };
  if (countRow.cnt > 0) {
    return;
  }

  const now = '2026-11-18T09:00:00.000Z';

  const insertTenant = db.prepare(
    `INSERT INTO tenants (id, slug, name, industry, tier, primary_domain, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertTenant.run('tenant_acme', 'acme-corp', 'Acme Corp', 'Enterprise Logistics', 'Enterprise', 'acmecorp.io', now);
  insertTenant.run('tenant_northstar', 'northstar-fin', 'Northstar Financial', 'FinTech & Payments', 'Enterprise Plus', 'northstarfin.com', now);
  insertTenant.run('tenant_vertex', 'vertex-health', 'Vertex Health', 'Clinical Systems', 'Growth', 'vertexhealth.org', now);

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, name, role, tenant_id, allowed_tenants_json, password_hash, title, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertUser.run(
    'usr_admin_elena',
    'elena.vance@relaylane.io',
    'Elena Vance',
    'INTERNAL_ADMIN',
    'tenant_acme',
    JSON.stringify(['tenant_acme', 'tenant_northstar', 'tenant_vertex']),
    null,
    'VP of Implementation & Security',
    now
  );
  insertUser.run(
    'usr_pm_marcus',
    'marcus.chen@relaylane.io',
    'Marcus Chen',
    'PROJECT_MANAGER',
    'tenant_acme',
    JSON.stringify(['tenant_acme', 'tenant_northstar']),
    null,
    'Lead Onboarding Architect',
    now
  );
  insertUser.run(
    'usr_client_acme',
    'priya.nair@acmecorp.io',
    'Priya Nair',
    'CLIENT_USER',
    'tenant_acme',
    JSON.stringify(['tenant_acme']),
    null,
    'IT Operations Director (Acme Corp)',
    now
  );
  insertUser.run(
    'usr_client_northstar',
    'david.okafor@northstarfin.com',
    'David Okafor',
    'CLIENT_USER',
    'tenant_northstar',
    JSON.stringify(['tenant_northstar']),
    null,
    'Head of Platform Risk (Northstar Financial)',
    now
  );

  // Project Templates
  const insertTemplate = db.prepare(
    `INSERT INTO project_templates (id, name, category, description, estimated_days, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertTemplate.run(
    'tpl_enterprise_sso',
    'Enterprise Core & SSO Rollout',
    'Enterprise SaaS',
    'End-to-end 30-day enterprise onboarding covering architecture kickoff, SAML/SSO configuration, historical data migration, UAT sign-off, and production cutover.',
    30,
    'Elena Vance',
    now
  );
  insertTemplate.run(
    'tpl_fintech_compliance',
    'FinTech Compliance & API Integration',
    'Financial Services',
    'Regulated onboarding blueprint featuring SOC2 evidence exchange, webhook signing validation, sandbox reconciliation, and dual-approval launch.',
    45,
    'Marcus Chen',
    now
  );
  insertTemplate.run(
    'tpl_clinical_launch',
    'Clinical Workspace & BAA Onboarding',
    'Healthcare',
    'Guided rollout for healthcare organizations with BAA execution, HL7 connector provisioning, and clinician training milestones.',
    21,
    'Elena Vance',
    now
  );

  const insertTplTask = db.prepare(
    `INSERT INTO template_tasks (id, template_id, phase, title, description, owner_type, client_visible, day_offset, sort_order, depends_on_orders_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Template 1 tasks
  const tpl1Tasks = [
    ['tpl1_t1', 'tpl_enterprise_sso', 'Phase 1 · Discovery & Kickoff', 'Confirm technical stakeholders & success metrics', 'Align executive sponsors, IT lead, and rollout KPIs during kickoff call.', 'CLIENT', 1, 2, 1, '[]'],
    ['tpl1_t2', 'tpl_enterprise_sso', 'Phase 1 · Discovery & Kickoff', 'Provision isolated tenant environment & VPC routing', 'Internal infra provisioning of dedicated tenant schema and KMS encryption keys.', 'INTERNAL', 0, 4, 2, '[1]'],
    ['tpl1_t3', 'tpl_enterprise_sso', 'Phase 2 · Identity & Data Setup', 'Configure SAML 2.0 / Okta SSO metadata', 'Client IT uploads IdP XML metadata and verifies test assertion.', 'CLIENT', 1, 8, 3, '[2]'],
    ['tpl1_t4', 'tpl_enterprise_sso', 'Phase 2 · Identity & Data Setup', 'Upload historical CSV records & field mapping', 'Provide sanitized legacy customer records using schema template v3.', 'CLIENT', 1, 12, 4, '[1]'],
    ['tpl1_t5', 'tpl_enterprise_sso', 'Phase 2 · Identity & Data Setup', 'Run staging ETL ingestion & schema validation', 'Verify row integrity, foreign keys, and tenant boundary isolation.', 'INTERNAL', 1, 16, 5, '[3,4]'],
    ['tpl1_t6', 'tpl_enterprise_sso', 'Phase 3 · UAT & Go-Live', 'Internal security & RBAC pen-test checklist', 'Verify Spring Security role matrix and Redis cache isolation before client UAT.', 'INTERNAL', 0, 20, 6, '[5]'],
    ['tpl1_t7', 'tpl_enterprise_sso', 'Phase 3 · UAT & Go-Live', 'Execute UAT sign-off & production DNS cutover', 'Client project lead validates 5 core workflows and signs production release.', 'CLIENT', 1, 28, 7, '[5,6]'],
  ] as const;
  for (const t of tpl1Tasks) {
    insertTplTask.run(...t);
  }

  // Template 2 tasks
  const tpl2Tasks = [
    ['tpl2_t1', 'tpl_fintech_compliance', 'Phase 1 · Risk & Security Gate', 'Submit SOC2 Type II & penetration test attestation', 'Exchange compliance package via encrypted portal.', 'INTERNAL', 1, 3, 1, '[]'],
    ['tpl2_t2', 'tpl_fintech_compliance', 'Phase 1 · Risk & Security Gate', 'Approve mTLS certificate & IP allowlist', 'Client InfoSec approves egress IPs and exchanges client certificate.', 'CLIENT', 1, 7, 2, '[1]'],
    ['tpl2_t3', 'tpl_fintech_compliance', 'Phase 2 · Ledger & Webhook Sync', 'Configure HMAC-signed webhook endpoints', 'Client engineering deploys webhook receiver and verifies signature check.', 'CLIENT', 1, 14, 3, '[2]'],
    ['tpl2_t4', 'tpl_fintech_compliance', 'Phase 2 · Ledger & Webhook Sync', 'Run 10,000-event sandbox settlement replay', 'Internal solutions team replays ledger events and checks idempotency.', 'INTERNAL', 1, 22, 4, '[3]'],
    ['tpl2_t5', 'tpl_fintech_compliance', 'Phase 3 · Production Cutover', 'Final compliance & dual-control sign-off', 'Joint risk sign-off prior to enabling live payment rail.', 'CLIENT', 1, 35, 5, '[4]'],
  ] as const;
  for (const t of tpl2Tasks) {
    insertTplTask.run(...t);
  }

  // Template 3 tasks
  const tpl3Tasks = [
    ['tpl3_t1', 'tpl_clinical_launch', 'Phase 1 · Legal & BAA', 'Countersign Business Associate Agreement (BAA)', 'Legal counsel completes HIPAA BAA execution.', 'CLIENT', 1, 3, 1, '[]'],
    ['tpl3_t2', 'tpl_clinical_launch', 'Phase 2 · EHR Integration', 'Provision FHIR/HL7 gateway credentials', 'Internal healthcare engineer configures encrypted relay.', 'INTERNAL', 1, 9, 2, '[1]'],
    ['tpl3_t3', 'tpl_clinical_launch', 'Phase 3 · Rollout', 'Conduct clinical admin readiness workshop', 'Live enablement session for 12 site coordinators.', 'INTERNAL', 1, 18, 3, '[2]'],
  ] as const;
  for (const t of tpl3Tasks) {
    insertTplTask.run(...t);
  }

  // Projects across 3 tenants
  const insertProject = db.prepare(
    `INSERT INTO projects (id, tenant_id, template_id, name, status, start_date, target_go_live, lead_pm_id, lead_pm_name, health, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertProject.run(
    'prj_acme_global',
    'tenant_acme',
    'tpl_enterprise_sso',
    'Acme Global Supply Chain Portal',
    'ACTIVE',
    '2026-11-04',
    '2026-12-04',
    'usr_pm_marcus',
    'Marcus Chen',
    'ON_TRACK',
    now
  );
  insertProject.run(
    'prj_acme_eu',
    'tenant_acme',
    'tpl_enterprise_sso',
    'Acme EMEA Warehouse Expansion',
    'ACTIVE',
    '2026-11-15',
    '2026-12-18',
    'usr_pm_marcus',
    'Marcus Chen',
    'AT_RISK',
    now
  );
  insertProject.run(
    'prj_northstar_rails',
    'tenant_northstar',
    'tpl_fintech_compliance',
    'Northstar Treasury & Ledger Onboarding',
    'ACTIVE',
    '2026-11-01',
    '2026-12-15',
    'usr_pm_marcus',
    'Marcus Chen',
    'ON_TRACK',
    now
  );
  insertProject.run(
    'prj_vertex_hipaa',
    'tenant_vertex',
    'tpl_clinical_launch',
    'Vertex Regional Clinic Rollout',
    'ACTIVE',
    '2026-11-10',
    '2026-12-02',
    'usr_admin_elena',
    'Elena Vance',
    'ON_TRACK',
    now
  );

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, tenant_id, project_id, phase, title, description, status, owner_type, assignee_name, assignee_role, client_visible, due_date, sort_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Acme Global tasks
  const acmeTasks = [
    ['tsk_acme_1', 'tenant_acme', 'prj_acme_global', 'Phase 1 · Discovery & Kickoff', 'Confirm technical stakeholders & success metrics', 'Align executive sponsors, IT lead, and rollout KPIs during kickoff call.', 'COMPLETED', 'CLIENT', 'Priya Nair', 'CLIENT_USER', 1, '2026-11-06', 1, '2026-11-06T14:20:00.000Z'],
    ['tsk_acme_2', 'tenant_acme', 'prj_acme_global', 'Phase 1 · Discovery & Kickoff', 'Provision isolated tenant environment & VPC routing', 'Internal infra provisioning of dedicated tenant schema and KMS encryption keys.', 'COMPLETED', 'INTERNAL', 'Elena Vance', 'INTERNAL_ADMIN', 0, '2026-11-08', 2, '2026-11-08T16:45:00.000Z'],
    ['tsk_acme_3', 'tenant_acme', 'prj_acme_global', 'Phase 2 · Identity & Data Setup', 'Configure SAML 2.0 / Okta SSO metadata', 'Client IT uploads IdP XML metadata and verifies test assertion.', 'IN_REVIEW', 'CLIENT', 'Priya Nair', 'CLIENT_USER', 1, '2026-11-26', 3, '2026-11-22T11:10:00.000Z'],
    ['tsk_acme_4', 'tenant_acme', 'prj_acme_global', 'Phase 2 · Identity & Data Setup', 'Upload historical CSV records & field mapping', 'Provide sanitized legacy customer records using schema template v3.', 'COMPLETED', 'CLIENT', 'Priya Nair', 'CLIENT_USER', 1, '2026-11-16', 4, '2026-11-15T17:05:00.000Z'],
    ['tsk_acme_5', 'tenant_acme', 'prj_acme_global', 'Phase 2 · Identity & Data Setup', 'Run staging ETL ingestion & schema validation', 'Verify row integrity, foreign keys, and tenant boundary isolation.', 'NOT_STARTED', 'INTERNAL', 'Marcus Chen', 'PROJECT_MANAGER', 1, '2026-11-28', 5, '2026-11-23T09:30:00.000Z'],
    ['tsk_acme_6', 'tenant_acme', 'prj_acme_global', 'Phase 3 · UAT & Go-Live', 'Internal security & RBAC pen-test checklist', 'Verify RBAC enforcement and Redis cache isolation before client UAT.', 'NOT_STARTED', 'INTERNAL', 'Elena Vance', 'INTERNAL_ADMIN', 0, '2026-12-01', 6, '2026-11-18T09:00:00.000Z'],
    ['tsk_acme_7', 'tenant_acme', 'prj_acme_global', 'Phase 3 · UAT & Go-Live', 'Execute UAT sign-off & production DNS cutover', 'Client project lead validates 5 core workflows and signs production release.', 'NOT_STARTED', 'CLIENT', 'Priya Nair', 'CLIENT_USER', 1, '2026-12-04', 7, '2026-11-18T09:00:00.000Z'],
  ] as const;
  for (const t of acmeTasks) insertTask.run(...t);

  // Acme EU tasks
  const acmeEuTasks = [
    ['tsk_acme_eu_1', 'tenant_acme', 'prj_acme_eu', 'Phase 1 · Discovery & Kickoff', 'GDPR DPA addendum countersignature', 'Legal teams finalize EU data residency addendum.', 'IN_PROGRESS', 'CLIENT', 'Priya Nair', 'CLIENT_USER', 1, '2026-11-27', 1, '2026-11-20T10:00:00.000Z'],
    ['tsk_acme_eu_2', 'tenant_acme', 'prj_acme_eu', 'Phase 2 · Regional Cluster', 'Allocate Frankfurt (eu-central-1) Redis shard', 'Internal cloud ops deploys regional cache cluster.', 'NOT_STARTED', 'INTERNAL', 'Elena Vance', 'INTERNAL_ADMIN', 0, '2026-12-03', 2, '2026-11-18T09:00:00.000Z'],
    ['tsk_acme_eu_3', 'tenant_acme', 'prj_acme_eu', 'Phase 3 · UAT & Go-Live', 'Validate localized carrier label templates', 'Confirm regional VAT and customs manifest fields.', 'NOT_STARTED', 'CLIENT', 'Priya Nair', 'CLIENT_USER', 1, '2026-12-14', 3, '2026-11-18T09:00:00.000Z'],
  ] as const;
  for (const t of acmeEuTasks) insertTask.run(...t);

  // Northstar Financial tasks
  const northstarTasks = [
    ['tsk_ns_1', 'tenant_northstar', 'prj_northstar_rails', 'Phase 1 · Risk & Security Gate', 'Submit SOC2 Type II & penetration test attestation', 'Exchange compliance package via encrypted portal.', 'COMPLETED', 'INTERNAL', 'Marcus Chen', 'PROJECT_MANAGER', 1, '2026-11-04', 1, '2026-11-04T15:00:00.000Z'],
    ['tsk_ns_2', 'tenant_northstar', 'prj_northstar_rails', 'Phase 1 · Risk & Security Gate', 'Approve mTLS certificate & IP allowlist', 'Client InfoSec approves egress IPs and exchanges client certificate.', 'COMPLETED', 'CLIENT', 'David Okafor', 'CLIENT_USER', 1, '2026-11-09', 2, '2026-11-09T18:10:00.000Z'],
    ['tsk_ns_3', 'tenant_northstar', 'prj_northstar_rails', 'Phase 2 · Ledger & Webhook Sync', 'Configure HMAC-signed webhook endpoints', 'Client engineering deploys webhook receiver and verifies signature check.', 'IN_PROGRESS', 'CLIENT', 'David Okafor', 'CLIENT_USER', 1, '2026-11-29', 3, '2026-11-22T14:00:00.000Z'],
    ['tsk_ns_4', 'tenant_northstar', 'prj_northstar_rails', 'Phase 2 · Ledger & Webhook Sync', 'Internal treasury reconciliation dry-run audit', 'Internal compliance lead checks dual-entry settlement logs.', 'NOT_STARTED', 'INTERNAL', 'Elena Vance', 'INTERNAL_ADMIN', 0, '2026-12-05', 4, '2026-11-18T09:00:00.000Z'],
    ['tsk_ns_5', 'tenant_northstar', 'prj_northstar_rails', 'Phase 3 · Production Cutover', 'Final compliance & dual-control sign-off', 'Joint risk sign-off prior to enabling live payment rail.', 'NOT_STARTED', 'CLIENT', 'David Okafor', 'CLIENT_USER', 1, '2026-12-14', 5, '2026-11-18T09:00:00.000Z'],
  ] as const;
  for (const t of northstarTasks) insertTask.run(...t);

  // Vertex Health tasks
  const vertexTasks = [
    ['tsk_vx_1', 'tenant_vertex', 'prj_vertex_hipaa', 'Phase 1 · Legal & BAA', 'Countersign Business Associate Agreement (BAA)', 'Legal counsel completes HIPAA BAA execution.', 'COMPLETED', 'CLIENT', 'Clinical Ops Team', 'CLIENT_USER', 1, '2026-11-13', 1, '2026-11-13T12:00:00.000Z'],
    ['tsk_vx_2', 'tenant_vertex', 'prj_vertex_hipaa', 'Phase 2 · EHR Integration', 'Provision FHIR/HL7 gateway credentials', 'Internal healthcare engineer configures encrypted relay.', 'IN_PROGRESS', 'INTERNAL', 'Elena Vance', 'INTERNAL_ADMIN', 1, '2026-11-25', 2, '2026-11-21T16:00:00.000Z'],
    ['tsk_vx_3', 'tenant_vertex', 'prj_vertex_hipaa', 'Phase 3 · Rollout', 'Conduct clinical admin readiness workshop', 'Live enablement session for 12 site coordinators.', 'NOT_STARTED', 'INTERNAL', 'Elena Vance', 'INTERNAL_ADMIN', 1, '2026-12-01', 3, '2026-11-18T09:00:00.000Z'],
  ] as const;
  for (const t of vertexTasks) insertTask.run(...t);

  // Dependencies
  const insertDep = db.prepare(
    `INSERT INTO task_dependencies (id, tenant_id, project_id, task_id, depends_on_task_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  // Acme Global dependencies
  insertDep.run('dep_1', 'tenant_acme', 'prj_acme_global', 'tsk_acme_2', 'tsk_acme_1', now);
  insertDep.run('dep_2', 'tenant_acme', 'prj_acme_global', 'tsk_acme_3', 'tsk_acme_2', now);
  insertDep.run('dep_3', 'tenant_acme', 'prj_acme_global', 'tsk_acme_5', 'tsk_acme_3', now);
  insertDep.run('dep_4', 'tenant_acme', 'prj_acme_global', 'tsk_acme_5', 'tsk_acme_4', now);
  insertDep.run('dep_5', 'tenant_acme', 'prj_acme_global', 'tsk_acme_6', 'tsk_acme_5', now);
  insertDep.run('dep_6', 'tenant_acme', 'prj_acme_global', 'tsk_acme_7', 'tsk_acme_5', now);
  insertDep.run('dep_7', 'tenant_acme', 'prj_acme_global', 'tsk_acme_7', 'tsk_acme_6', now);
  // Acme EU dependencies
  insertDep.run('dep_8', 'tenant_acme', 'prj_acme_eu', 'tsk_acme_eu_2', 'tsk_acme_eu_1', now);
  insertDep.run('dep_9', 'tenant_acme', 'prj_acme_eu', 'tsk_acme_eu_3', 'tsk_acme_eu_2', now);
  // Northstar dependencies
  insertDep.run('dep_10', 'tenant_northstar', 'prj_northstar_rails', 'tsk_ns_2', 'tsk_ns_1', now);
  insertDep.run('dep_11', 'tenant_northstar', 'prj_northstar_rails', 'tsk_ns_3', 'tsk_ns_2', now);
  insertDep.run('dep_12', 'tenant_northstar', 'prj_northstar_rails', 'tsk_ns_4', 'tsk_ns_3', now);
  insertDep.run('dep_13', 'tenant_northstar', 'prj_northstar_rails', 'tsk_ns_5', 'tsk_ns_4', now);
  // Vertex dependencies
  insertDep.run('dep_14', 'tenant_vertex', 'prj_vertex_hipaa', 'tsk_vx_2', 'tsk_vx_1', now);
  insertDep.run('dep_15', 'tenant_vertex', 'prj_vertex_hipaa', 'tsk_vx_3', 'tsk_vx_2', now);

  // Initial Audit Logs
  const insertAudit = db.prepare(
    `INSERT INTO audit_logs (id, tenant_id, project_id, task_id, actor_id, actor_name, actor_role, event_type, from_status, to_status, entity_label, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertAudit.run(
    'aud_1',
    'tenant_acme',
    'prj_acme_global',
    'tsk_acme_1',
    'usr_client_acme',
    'Priya Nair',
    'CLIENT_USER',
    'STATUS_TRANSITION',
    'IN_PROGRESS',
    'COMPLETED',
    'Confirm technical stakeholders & success metrics',
    'Client sponsor roster and go-live SLA approved during kickoff.',
    '2026-11-06T14:20:00.000Z'
  );
  insertAudit.run(
    'aud_2',
    'tenant_acme',
    'prj_acme_global',
    'tsk_acme_2',
    'usr_admin_elena',
    'Elena Vance',
    'INTERNAL_ADMIN',
    'STATUS_TRANSITION',
    'IN_PROGRESS',
    'COMPLETED',
    'Provision isolated tenant environment & VPC routing',
    'Dedicated schema and KMS envelope keys verified.',
    '2026-11-08T16:45:00.000Z'
  );
  insertAudit.run(
    'aud_3',
    'tenant_acme',
    'prj_acme_global',
    'tsk_acme_3',
    'usr_client_acme',
    'Priya Nair',
    'CLIENT_USER',
    'STATUS_TRANSITION',
    'IN_PROGRESS',
    'IN_REVIEW',
    'Configure SAML 2.0 / Okta SSO metadata',
    'Uploaded Okta metadata XML for PM verification.',
    '2026-11-22T11:10:00.000Z'
  );
  insertAudit.run(
    'aud_4',
    'tenant_northstar',
    'prj_northstar_rails',
    'tsk_ns_2',
    'usr_client_northstar',
    'David Okafor',
    'CLIENT_USER',
    'STATUS_TRANSITION',
    'IN_REVIEW',
    'COMPLETED',
    'Approve mTLS certificate & IP allowlist',
    'InfoSec team approved production egress IP block.',
    '2026-11-09T18:10:00.000Z'
  );
  insertAudit.run(
    'aud_5',
    'tenant_northstar',
    'prj_northstar_rails',
    'tsk_ns_3',
    'usr_client_northstar',
    'David Okafor',
    'CLIENT_USER',
    'STATUS_TRANSITION',
    'NOT_STARTED',
    'IN_PROGRESS',
    'Configure HMAC-signed webhook endpoints',
    'Staging listener deployed; testing signature replay protection.',
    '2026-11-22T14:00:00.000Z'
  );
  insertAudit.run(
    'aud_6',
    'tenant_vertex',
    'prj_vertex_hipaa',
    'tsk_vx_1',
    'usr_admin_elena',
    'Elena Vance',
    'INTERNAL_ADMIN',
    'STATUS_TRANSITION',
    'IN_REVIEW',
    'COMPLETED',
    'Countersign Business Associate Agreement (BAA)',
    'Executed BAA archived in compliance vault.',
    '2026-11-13T12:00:00.000Z'
  );
}

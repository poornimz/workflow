import crypto from 'node:crypto';
import type {
  AuditEventType,
  AuditLogEntry,
  OnboardingTask,
  ProjectBoardResponse,
  ProjectHealth,
  ProjectSummary,
  ProjectTemplate,
  TaskDependency,
  TaskOwnerType,
  TaskStatus,
  TemplateTask,
  Tenant,
  UserAccount,
  UserRole,
} from '../shared/types.ts';
import { db } from './db.ts';
import { redisStore } from './redisStore.ts';
import type { TenantContext } from './security.ts';

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function writeAuditLog(params: {
  tenantId: string;
  projectId?: string | null;
  taskId?: string | null;
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'SYSTEM';
  eventType: AuditEventType;
  fromStatus?: string | null;
  toStatus?: string | null;
  entityLabel: string;
  details: string;
}): AuditLogEntry {
  const id = `aud_${crypto.randomUUID().slice(0, 12)}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_logs
      (id, tenant_id, project_id, task_id, actor_id, actor_name, actor_role, event_type, from_status, to_status, entity_label, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.tenantId,
    params.projectId ?? null,
    params.taskId ?? null,
    params.actorId,
    params.actorName,
    params.actorRole,
    params.eventType,
    params.fromStatus ?? null,
    params.toStatus ?? null,
    params.entityLabel,
    params.details,
    createdAt
  );

  return {
    id,
    tenantId: params.tenantId,
    projectId: params.projectId ?? null,
    taskId: params.taskId ?? null,
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    eventType: params.eventType,
    fromStatus: params.fromStatus ?? null,
    toStatus: params.toStatus ?? null,
    entityLabel: params.entityLabel,
    details: params.details,
    createdAt,
  };
}

export function listAllTenants(): Tenant[] {
  const rows = db
    .prepare(
      `SELECT id, slug, name, industry, tier, primary_domain as primaryDomain, created_at as createdAt
       FROM tenants ORDER BY name ASC`
    )
    .all() as unknown as Tenant[];
  return rows;
}

export function listAccessibleTenants(ctx: {
  role: UserRole;
  tenantId: string;
  allowedTenants: string[];
}): Tenant[] {
  const all = listAllTenants();
  if (ctx.role === 'INTERNAL_ADMIN') {
    return all;
  }
  if (ctx.role === 'PROJECT_MANAGER') {
    return all.filter((t) => ctx.allowedTenants.includes(t.id));
  }
  return all.filter((t) => t.id === ctx.tenantId);
}

export function getTenantById(tenantId: string): Tenant | null {
  const row = db
    .prepare(
      `SELECT id, slug, name, industry, tier, primary_domain as primaryDomain, created_at as createdAt
       FROM tenants WHERE id = ?`
    )
    .get(tenantId) as unknown as Tenant | undefined;
  return row ?? null;
}

export function createTenant(
  ctx: TenantContext,
  input: { name: string; slug: string; industry: string; tier: string; primaryDomain: string }
): Tenant {
  if (ctx.role !== 'INTERNAL_ADMIN') {
    throw new HttpError(403, 'RBAC_FORBIDDEN', 'Only internal admins can provision new client tenants.');
  }
  const cleanSlug = input.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleanSlug || !input.name.trim()) {
    throw new HttpError(400, 'INVALID_TENANT', 'Tenant name and slug are required.');
  }

  const existing = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(cleanSlug);
  if (existing) {
    throw new HttpError(409, 'DUPLICATE_SLUG', `Tenant slug "${cleanSlug}" already exists.`);
  }

  const id = `tenant_${cleanSlug.replace(/-/g, '_')}_${crypto.randomUUID().slice(0, 4)}`;
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO tenants (id, slug, name, industry, tier, primary_domain, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    cleanSlug,
    input.name.trim(),
    input.industry.trim() || 'Enterprise SaaS',
    input.tier.trim() || 'Enterprise',
    input.primaryDomain.trim() || `${cleanSlug}.com`,
    createdAt
  );

  // Grant internal admins visibility automatically via listAllTenants; also log audit
  writeAuditLog({
    tenantId: id,
    actorId: ctx.userId,
    actorName: ctx.userName,
    actorRole: ctx.role,
    eventType: 'PROJECT_CREATED',
    entityLabel: `Tenant: ${input.name.trim()}`,
    details: `Provisioned isolated client tenant (${id}) with domain ${input.primaryDomain.trim()}.`,
  });

  return {
    id,
    slug: cleanSlug,
    name: input.name.trim(),
    industry: input.industry.trim() || 'Enterprise SaaS',
    tier: input.tier.trim() || 'Enterprise',
    primaryDomain: input.primaryDomain.trim() || `${cleanSlug}.com`,
    createdAt,
  };
}

export function listUsersForWorkspace(tenantFilter?: string): UserAccount[] {
  const sql = tenantFilter
    ? `SELECT id, email, name, role, tenant_id as tenantId, allowed_tenants_json as allowedTenantsJson, title, created_at as createdAt
       FROM users WHERE tenant_id = ? ORDER BY role ASC, name ASC`
    : `SELECT id, email, name, role, tenant_id as tenantId, allowed_tenants_json as allowedTenantsJson, title, created_at as createdAt
       FROM users ORDER BY role ASC, name ASC`;

  const rows = (tenantFilter ? db.prepare(sql).all(tenantFilter) : db.prepare(sql).all()) as Array<{
    id: string;
    email: string;
    name: string;
    role: UserRole;
    tenantId: string;
    allowedTenantsJson: string;
    title: string;
    createdAt: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    tenantId: r.tenantId,
    allowedTenants: JSON.parse(r.allowedTenantsJson) as string[],
    title: r.title,
    createdAt: r.createdAt,
  }));
}

export function listProjectsForTenant(ctx: TenantContext): {
  projects: ProjectSummary[];
  cacheStatus: 'HIT' | 'MISS';
} {
  const scopeKey = `projects:tenant:${ctx.tenantId}:role:${ctx.role}`;
  const cached = redisStore.get<ProjectSummary[]>(scopeKey);
  if (cached) {
    return { projects: cached.value, cacheStatus: 'HIT' };
  }

  const visibilityClause = ctx.role === 'CLIENT_USER' ? 'AND t.client_visible = 1' : '';
  const rows = db
    .prepare(
      `SELECT
        p.id,
        p.tenant_id as tenantId,
        tn.name as tenantName,
        p.template_id as templateId,
        pt.name as templateName,
        p.name,
        p.status,
        p.start_date as startDate,
        p.target_go_live as targetGoLive,
        p.lead_pm_id as leadPmId,
        p.lead_pm_name as leadPmName,
        p.health,
        p.created_at as createdAt,
        COUNT(t.id) as totalTasks,
        SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END) as completedTasks,
        SUM(CASE WHEN t.status = 'BLOCKED' THEN 1 ELSE 0 END) as blockedTasks
      FROM projects p
      JOIN tenants tn ON tn.id = p.tenant_id
      LEFT JOIN project_templates pt ON pt.id = p.template_id
      LEFT JOIN tasks t ON t.project_id = p.id AND t.tenant_id = p.tenant_id ${visibilityClause}
      WHERE p.tenant_id = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC`
    )
    .all(ctx.tenantId) as unknown as ProjectSummary[];

  const normalized = rows.map((r) => ({
    ...r,
    totalTasks: Number(r.totalTasks ?? 0),
    completedTasks: Number(r.completedTasks ?? 0),
    blockedTasks: Number(r.blockedTasks ?? 0),
  }));

  redisStore.set(scopeKey, normalized, 90, {
    namespace: 'projects',
    tenantId: ctx.tenantId,
    preview: `${normalized.length} project(s) [${ctx.role}]`,
  });

  return { projects: normalized, cacheStatus: 'MISS' };
}

export function getProjectBoard(ctx: TenantContext, projectId: string): ProjectBoardResponse {
  const cacheKey = `board:tenant:${ctx.tenantId}:project:${projectId}:role:${ctx.role}`;
  const cached = redisStore.get<{ project: ProjectSummary; tasks: OnboardingTask[] }>(cacheKey);
  if (cached) {
    return {
      project: cached.value.project,
      tasks: cached.value.tasks,
      cache: {
        status: 'HIT',
        key: cacheKey,
        ttlRemainingSeconds: cached.ttlRemainingSeconds,
        cachedAt: cached.createdAt,
      },
    };
  }

  // Strict tenant_id isolation on project lookup
  const projectRow = db
    .prepare(
      `SELECT
        p.id,
        p.tenant_id as tenantId,
        tn.name as tenantName,
        p.template_id as templateId,
        pt.name as templateName,
        p.name,
        p.status,
        p.start_date as startDate,
        p.target_go_live as targetGoLive,
        p.lead_pm_id as leadPmId,
        p.lead_pm_name as leadPmName,
        p.health,
        p.created_at as createdAt
      FROM projects p
      JOIN tenants tn ON tn.id = p.tenant_id
      LEFT JOIN project_templates pt ON pt.id = p.template_id
      WHERE p.id = ? AND p.tenant_id = ?`
    )
    .get(projectId, ctx.tenantId) as unknown as Omit<
    ProjectSummary,
    'totalTasks' | 'completedTasks' | 'blockedTasks'
  > | undefined;

  if (!projectRow) {
    // Check if project exists in another tenant to log cross-tenant isolation guard
    const foreignProject = db.prepare('SELECT tenant_id as tenantId, name FROM projects WHERE id = ?').get(projectId) as
      | { tenantId: string; name: string }
      | undefined;
    if (foreignProject) {
      writeAuditLog({
        tenantId: ctx.tenantId,
        projectId,
        actorId: ctx.userId,
        actorName: ctx.userName,
        actorRole: ctx.role,
        eventType: 'ACCESS_DENIED',
        entityLabel: `Project ${projectId}`,
        details: `Blocked cross-tenant project read: context ${ctx.tenantId} attempted to read project owned by ${foreignProject.tenantId}.`,
      });
      throw new HttpError(
        403,
        'TENANT_ISOLATION_VIOLATION',
        `Tenant isolation violation: Project ${projectId} does not belong to tenant ${ctx.tenantId}.`
      );
    }
    throw new HttpError(404, 'PROJECT_NOT_FOUND', `Project ${projectId} not found in tenant ${ctx.tenantId}.`);
  }

  const clientFilter = ctx.role === 'CLIENT_USER' ? 'AND client_visible = 1' : '';
  const rawTasks = db
    .prepare(
      `SELECT
        id,
        tenant_id as tenantId,
        project_id as projectId,
        phase,
        title,
        description,
        status,
        owner_type as ownerType,
        assignee_name as assigneeName,
        assignee_role as assigneeRole,
        client_visible as clientVisible,
        due_date as dueDate,
        sort_order as sortOrder,
        updated_at as updatedAt
      FROM tasks
      WHERE project_id = ? AND tenant_id = ? ${clientFilter}
      ORDER BY sort_order ASC`
    )
    .all(projectId, ctx.tenantId) as Array<{
    id: string;
    tenantId: string;
    projectId: string;
    phase: string;
    title: string;
    description: string;
    status: TaskStatus;
    ownerType: TaskOwnerType;
    assigneeName: string;
    assigneeRole: UserRole;
    clientVisible: number;
    dueDate: string;
    sortOrder: number;
    updatedAt: string;
  }>;

  const depRows = db
    .prepare(
      `SELECT
        d.id,
        d.task_id as taskId,
        d.depends_on_task_id as dependsOnTaskId,
        up.title as dependsOnTitle,
        up.status as dependsOnStatus,
        up.phase as dependsOnPhase,
        up.client_visible as dependsOnClientVisible
      FROM task_dependencies d
      JOIN tasks up ON up.id = d.depends_on_task_id AND up.tenant_id = d.tenant_id
      WHERE d.project_id = ? AND d.tenant_id = ?`
    )
    .all(projectId, ctx.tenantId) as Array<{
    id: string;
    taskId: string;
    dependsOnTaskId: string;
    dependsOnTitle: string;
    dependsOnStatus: TaskStatus;
    dependsOnPhase: string;
    dependsOnClientVisible: number;
  }>;

  const visibleTaskIds = new Set(rawTasks.map((t) => t.id));
  const depsByTask = new Map<string, TaskDependency[]>();
  const blockingCounts = new Map<string, number>();

  for (const dep of depRows) {
    // Never leak internal-only task titles into external client responses
    if (ctx.role === 'CLIENT_USER' && (!visibleTaskIds.has(dep.taskId) || dep.dependsOnClientVisible === 0)) {
      continue;
    }
    const list = depsByTask.get(dep.taskId) ?? [];
    list.push({
      id: dep.id,
      taskId: dep.taskId,
      dependsOnTaskId: dep.dependsOnTaskId,
      dependsOnTitle: dep.dependsOnTitle,
      dependsOnStatus: dep.dependsOnStatus,
      dependsOnPhase: dep.dependsOnPhase,
    });
    depsByTask.set(dep.taskId, list);
    blockingCounts.set(dep.dependsOnTaskId, (blockingCounts.get(dep.dependsOnTaskId) ?? 0) + 1);
  }

  // Also check raw unmet dependencies (even if internal-only, a client task waiting on an internal provisioning step knows it's gated)
  const rawUnmetByTask = new Map<string, number>();
  for (const dep of depRows) {
    if (dep.dependsOnStatus !== 'COMPLETED') {
      rawUnmetByTask.set(dep.taskId, (rawUnmetByTask.get(dep.taskId) ?? 0) + 1);
    }
  }

  const tasks: OnboardingTask[] = rawTasks.map((t) => {
    const deps = depsByTask.get(t.id) ?? [];
    const unmetCount = rawUnmetByTask.get(t.id) ?? 0;
    return {
      id: t.id,
      tenantId: t.tenantId,
      projectId: t.projectId,
      phase: t.phase,
      title: t.title,
      description: t.description,
      status: t.status,
      ownerType: t.ownerType,
      assigneeName: t.assigneeName,
      assigneeRole: t.assigneeRole,
      clientVisible: Boolean(t.clientVisible),
      dueDate: t.dueDate,
      sortOrder: t.sortOrder,
      updatedAt: t.updatedAt,
      dependencies: deps,
      blockingCount: blockingCounts.get(t.id) ?? 0,
      isDependencyBlocked: unmetCount > 0,
    };
  });

  const project: ProjectSummary = {
    ...projectRow,
    totalTasks: tasks.length,
    completedTasks: tasks.filter((t) => t.status === 'COMPLETED').length,
    blockedTasks: tasks.filter((t) => t.status === 'BLOCKED' || (t.isDependencyBlocked && t.status !== 'COMPLETED')).length,
  };

  const ttlSeconds = 120;
  redisStore.set(
    cacheKey,
    { project, tasks },
    ttlSeconds,
    {
      namespace: 'board',
      tenantId: ctx.tenantId,
      preview: `${project.name} (${tasks.length} tasks)`,
    }
  );

  return {
    project,
    tasks,
    cache: {
      status: 'MISS',
      key: cacheKey,
      ttlRemainingSeconds: ttlSeconds,
      cachedAt: new Date().toISOString(),
    },
  };
}

export function transitionTaskStatus(
  ctx: TenantContext,
  taskId: string,
  toStatus: TaskStatus,
  reason?: string
): OnboardingTask {
  const validStatuses: TaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];
  if (!validStatuses.includes(toStatus)) {
    throw new HttpError(400, 'INVALID_STATUS', `Unsupported task status: ${toStatus}`);
  }

  const task = db
    .prepare(
      `SELECT id, tenant_id as tenantId, project_id as projectId, phase, title, description, status,
              owner_type as ownerType, assignee_name as assigneeName, assignee_role as assigneeRole,
              client_visible as clientVisible, due_date as dueDate, sort_order as sortOrder, updated_at as updatedAt
       FROM tasks WHERE id = ? AND tenant_id = ?`
    )
    .get(taskId, ctx.tenantId) as
    | {
        id: string;
        tenantId: string;
        projectId: string;
        phase: string;
        title: string;
        description: string;
        status: TaskStatus;
        ownerType: TaskOwnerType;
        assigneeName: string;
        assigneeRole: UserRole;
        clientVisible: number;
        dueDate: string;
        sortOrder: number;
        updatedAt: string;
      }
    | undefined;

  if (!task) {
    throw new HttpError(404, 'TASK_NOT_FOUND', `Task ${taskId} not found in tenant ${ctx.tenantId}.`);
  }

  // RBAC: External clients can only transition client-visible, client-owned tasks (and cannot directly force COMPLETED on gated internal reviews unless ownerType is CLIENT)
  if (ctx.role === 'CLIENT_USER') {
    if (task.clientVisible === 0) {
      throw new HttpError(403, 'RBAC_FORBIDDEN', 'External client users cannot view or modify internal tasks.');
    }
    if (task.ownerType !== 'CLIENT') {
      throw new HttpError(
        403,
        'RBAC_FORBIDDEN',
        'External client users can only transition tasks owned by the Client team.'
      );
    }
  }

  // Dependency Gate Check when activating or completing a task
  if (toStatus === 'IN_PROGRESS' || toStatus === 'IN_REVIEW' || toStatus === 'COMPLETED') {
    const blockers = db
      .prepare(
        `SELECT up.id, up.title, up.status, up.client_visible as clientVisible
         FROM task_dependencies d
         JOIN tasks up ON up.id = d.depends_on_task_id AND up.tenant_id = d.tenant_id
         WHERE d.task_id = ? AND d.tenant_id = ? AND up.status != 'COMPLETED'`
      )
      .all(taskId, ctx.tenantId) as Array<{
      id: string;
      title: string;
      status: TaskStatus;
      clientVisible: number;
    }>;

    if (blockers.length > 0) {
      const visibleLabels = blockers.map((b) =>
        ctx.role === 'CLIENT_USER' && b.clientVisible === 0
          ? 'Internal prerequisite milestone'
          : `"${b.title}" (${b.status})`
      );
      throw new HttpError(
        409,
        'DEPENDENCY_GATE_BLOCKED',
        `Cannot transition to ${toStatus} until upstream dependencies complete: ${visibleLabels.join(', ')}`,
        { blockers: visibleLabels }
      );
    }
  }

  const fromStatus = task.status;
  const updatedAt = new Date().toISOString();

  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(
    toStatus,
    updatedAt,
    taskId,
    ctx.tenantId
  );

  writeAuditLog({
    tenantId: ctx.tenantId,
    projectId: task.projectId,
    taskId: task.id,
    actorId: ctx.userId,
    actorName: ctx.userName,
    actorRole: ctx.role,
    eventType: 'STATUS_TRANSITION',
    fromStatus,
    toStatus,
    entityLabel: task.title,
    details: reason?.trim() || `Transitioned status from ${fromStatus} to ${toStatus}.`,
  });

  const invalidated = redisStore.invalidateTenantBoards(ctx.tenantId);
  if (invalidated > 0) {
    writeAuditLog({
      tenantId: ctx.tenantId,
      projectId: task.projectId,
      actorId: 'SYSTEM',
      actorName: 'Redis Cache Engine',
      actorRole: 'SYSTEM',
      eventType: 'CACHE_INVALIDATED',
      entityLabel: `Tenant ${ctx.tenantId} Board Cache`,
      details: `Evicted ${invalidated} cached board/project key(s) after status transition on "${task.title}".`,
    });
  }

  const refreshedBoard = getProjectBoard(ctx, task.projectId);
  const updated = refreshedBoard.tasks.find((t) => t.id === taskId);
  if (!updated) {
    throw new HttpError(500, 'TASK_REFRESH_ERROR', 'Failed to reload updated task.');
  }
  return updated;
}

export function updateTaskDetails(
  ctx: TenantContext,
  taskId: string,
  updates: {
    title?: string;
    description?: string;
    assigneeName?: string;
    dueDate?: string;
    clientVisible?: boolean;
    ownerType?: TaskOwnerType;
  }
): OnboardingTask {
  if (ctx.role === 'CLIENT_USER') {
    throw new HttpError(
      403,
      'RBAC_FORBIDDEN',
      'External client users cannot modify task metadata, visibility, or ownership.'
    );
  }

  const task = db
    .prepare('SELECT id, project_id as projectId, title FROM tasks WHERE id = ? AND tenant_id = ?')
    .get(taskId, ctx.tenantId) as { id: string; projectId: string; title: string } | undefined;

  if (!task) {
    throw new HttpError(404, 'TASK_NOT_FOUND', `Task ${taskId} not found in tenant ${ctx.tenantId}.`);
  }

  const fields: string[] = [];
  const values: Array<string | number> = [];

  if (updates.title !== undefined && updates.title.trim()) {
    fields.push('title = ?');
    values.push(updates.title.trim());
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description.trim());
  }
  if (updates.assigneeName !== undefined && updates.assigneeName.trim()) {
    fields.push('assignee_name = ?');
    values.push(updates.assigneeName.trim());
  }
  if (updates.dueDate !== undefined && updates.dueDate.trim()) {
    fields.push('due_date = ?');
    values.push(updates.dueDate.trim());
  }
  if (updates.clientVisible !== undefined) {
    fields.push('client_visible = ?');
    values.push(updates.clientVisible ? 1 : 0);
  }
  if (updates.ownerType !== undefined) {
    fields.push('owner_type = ?');
    values.push(updates.ownerType);
  }

  if (fields.length === 0) {
    throw new HttpError(400, 'NO_UPDATES', 'No valid task fields supplied.');
  }

  const updatedAt = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(updatedAt, taskId, ctx.tenantId);

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);

  writeAuditLog({
    tenantId: ctx.tenantId,
    projectId: task.projectId,
    taskId: task.id,
    actorId: ctx.userId,
    actorName: ctx.userName,
    actorRole: ctx.role,
    eventType: 'TASK_UPDATED',
    entityLabel: updates.title?.trim() || task.title,
    details: `Updated task properties (${Object.keys(updates).join(', ')}).`,
  });

  redisStore.invalidateTenantBoards(ctx.tenantId);
  const refreshed = getProjectBoard(ctx, task.projectId).tasks.find((t) => t.id === taskId);
  if (!refreshed) {
    throw new HttpError(500, 'TASK_REFRESH_ERROR', 'Failed to reload updated task.');
  }
  return refreshed;
}

export function createTask(
  ctx: TenantContext,
  projectId: string,
  input: {
    phase: string;
    title: string;
    description: string;
    ownerType: TaskOwnerType;
    assigneeName: string;
    clientVisible: boolean;
    dueDate: string;
  }
): OnboardingTask {
  if (ctx.role === 'CLIENT_USER') {
    throw new HttpError(403, 'RBAC_FORBIDDEN', 'External client users cannot create project tasks.');
  }

  const project = db
    .prepare('SELECT id, name FROM projects WHERE id = ? AND tenant_id = ?')
    .get(projectId, ctx.tenantId) as { id: string; name: string } | undefined;

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', `Project ${projectId} not found in tenant ${ctx.tenantId}.`);
  }

  if (!input.title.trim()) {
    throw new HttpError(400, 'INVALID_TASK', 'Task title is required.');
  }

  const maxSortRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as maxOrder FROM tasks WHERE project_id = ? AND tenant_id = ?')
    .get(projectId, ctx.tenantId) as { maxOrder: number };

  const taskId = `tsk_${crypto.randomUUID().slice(0, 10)}`;
  const updatedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO tasks
      (id, tenant_id, project_id, phase, title, description, status, owner_type, assignee_name, assignee_role, client_visible, due_date, sort_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'NOT_STARTED', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    taskId,
    ctx.tenantId,
    projectId,
    input.phase.trim() || 'Phase 1 · Discovery & Kickoff',
    input.title.trim(),
    input.description.trim(),
    input.ownerType,
    input.assigneeName.trim() || ctx.userName,
    input.ownerType === 'CLIENT' ? 'CLIENT_USER' : 'PROJECT_MANAGER',
    input.clientVisible ? 1 : 0,
    input.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    Number(maxSortRow.maxOrder) + 1,
    updatedAt
  );

  writeAuditLog({
    tenantId: ctx.tenantId,
    projectId,
    taskId,
    actorId: ctx.userId,
    actorName: ctx.userName,
    actorRole: ctx.role,
    eventType: 'TASK_CREATED',
    toStatus: 'NOT_STARTED',
    entityLabel: input.title.trim(),
    details: `Added ${input.ownerType.toLowerCase()} task to "${project.name}" (${input.clientVisible ? 'client-visible' : 'internal-only'}).`,
  });

  redisStore.invalidateTenantBoards(ctx.tenantId);
  const created = getProjectBoard(ctx, projectId).tasks.find((t) => t.id === taskId);
  if (!created) {
    throw new HttpError(500, 'TASK_REFRESH_ERROR', 'Failed to reload created task.');
  }
  return created;
}

export function addTaskDependency(
  ctx: TenantContext,
  taskId: string,
  dependsOnTaskId: string
): OnboardingTask {
  if (ctx.role === 'CLIENT_USER') {
    throw new HttpError(403, 'RBAC_FORBIDDEN', 'External client users cannot alter workflow dependencies.');
  }
  if (taskId === dependsOnTaskId) {
    throw new HttpError(400, 'SELF_DEPENDENCY', 'A task cannot depend on itself.');
  }

  const target = db
    .prepare('SELECT id, project_id as projectId, title FROM tasks WHERE id = ? AND tenant_id = ?')
    .get(taskId, ctx.tenantId) as { id: string; projectId: string; title: string } | undefined;
  const upstream = db
    .prepare('SELECT id, project_id as projectId, title FROM tasks WHERE id = ? AND tenant_id = ?')
    .get(dependsOnTaskId, ctx.tenantId) as { id: string; projectId: string; title: string } | undefined;

  if (!target || !upstream) {
    throw new HttpError(404, 'TASK_NOT_FOUND', 'Both tasks must exist within the same tenant.');
  }
  if (target.projectId !== upstream.projectId) {
    throw new HttpError(400, 'CROSS_PROJECT_DEPENDENCY', 'Dependencies must link tasks within the same project.');
  }

  // Cycle detection: check if upstream transitively depends on target
  const allDeps = db
    .prepare('SELECT task_id as taskId, depends_on_task_id as dependsOnTaskId FROM task_dependencies WHERE project_id = ? AND tenant_id = ?')
    .all(target.projectId, ctx.tenantId) as Array<{ taskId: string; dependsOnTaskId: string }>;

  const adjacency = new Map<string, string[]>();
  for (const d of allDeps) {
    const arr = adjacency.get(d.taskId) ?? [];
    arr.push(d.dependsOnTaskId);
    adjacency.set(d.taskId, arr);
  }

  const visited = new Set<string>();
  const stack = [dependsOnTaskId];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr === taskId) {
      throw new HttpError(
        409,
        'CIRCULAR_DEPENDENCY',
        `Adding dependency "${upstream.title}" -> "${target.title}" would create a circular dependency cycle.`
      );
    }
    if (!visited.has(curr)) {
      visited.add(curr);
      for (const next of adjacency.get(curr) ?? []) {
        stack.push(next);
      }
    }
  }

  const exists = db
    .prepare('SELECT id FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ? AND tenant_id = ?')
    .get(taskId, dependsOnTaskId, ctx.tenantId);

  if (exists) {
    throw new HttpError(409, 'DUPLICATE_DEPENDENCY', 'This dependency already exists.');
  }

  const depId = `dep_${crypto.randomUUID().slice(0, 10)}`;
  db.prepare(
    `INSERT INTO task_dependencies (id, tenant_id, project_id, task_id, depends_on_task_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(depId, ctx.tenantId, target.projectId, taskId, dependsOnTaskId, new Date().toISOString());

  writeAuditLog({
    tenantId: ctx.tenantId,
    projectId: target.projectId,
    taskId,
    actorId: ctx.userId,
    actorName: ctx.userName,
    actorRole: ctx.role,
    eventType: 'DEPENDENCY_ADDED',
    entityLabel: target.title,
    details: `Linked prerequisite dependency: must complete "${upstream.title}" first.`,
  });

  redisStore.invalidateTenantBoards(ctx.tenantId);
  return getProjectBoard(ctx, target.projectId).tasks.find((t) => t.id === taskId)!;
}

export function removeTaskDependency(ctx: TenantContext, taskId: string, dependencyId: string): OnboardingTask {
  if (ctx.role === 'CLIENT_USER') {
    throw new HttpError(403, 'RBAC_FORBIDDEN', 'External client users cannot alter workflow dependencies.');
  }

  const dep = db
    .prepare(
      `SELECT d.id, d.project_id as projectId, t.title as taskTitle, u.title as upstreamTitle
       FROM task_dependencies d
       JOIN tasks t ON t.id = d.task_id AND t.tenant_id = d.tenant_id
       JOIN tasks u ON u.id = d.depends_on_task_id AND u.tenant_id = d.tenant_id
       WHERE d.id = ? AND d.task_id = ? AND d.tenant_id = ?`
    )
    .get(dependencyId, taskId, ctx.tenantId) as
    | { id: string; projectId: string; taskTitle: string; upstreamTitle: string }
    | undefined;

  if (!dep) {
    throw new HttpError(404, 'DEPENDENCY_NOT_FOUND', 'Dependency link not found in active tenant.');
  }

  db.prepare('DELETE FROM task_dependencies WHERE id = ? AND tenant_id = ?').run(dependencyId, ctx.tenantId);

  writeAuditLog({
    tenantId: ctx.tenantId,
    projectId: dep.projectId,
    taskId,
    actorId: ctx.userId,
    actorName: ctx.userName,
    actorRole: ctx.role,
    eventType: 'DEPENDENCY_REMOVED',
    entityLabel: dep.taskTitle,
    details: `Removed prerequisite dependency on "${dep.upstreamTitle}".`,
  });

  redisStore.invalidateTenantBoards(ctx.tenantId);
  return getProjectBoard(ctx, dep.projectId).tasks.find((t) => t.id === taskId)!;
}

export function listTemplates(ctx: TenantContext): ProjectTemplate[] {
  if (ctx.role === 'CLIENT_USER') {
    throw new HttpError(403, 'RBAC_FORBIDDEN', 'Project blueprint templates are restricted to internal teams.');
  }

  const templates = db
    .prepare(
      `SELECT id, name, category, description, estimated_days as estimatedDays, created_by as createdBy, created_at as createdAt
       FROM project_templates ORDER BY created_at DESC`
    )
    .all() as Array<Omit<ProjectTemplate, 'tasks'>>;

  const taskRows = db
    .prepare(
      `SELECT id, template_id as templateId, phase, title, description, owner_type as ownerType,
              client_visible as clientVisible, day_offset as dayOffset, sort_order as sortOrder,
              depends_on_orders_json as dependsOnOrdersJson
       FROM template_tasks ORDER BY sort_order ASC`
    )
    .all() as Array<{
    id: string;
    templateId: string;
    phase: string;
    title: string;
    description: string;
    ownerType: TaskOwnerType;
    clientVisible: number;
    dayOffset: number;
    sortOrder: number;
    dependsOnOrdersJson: string;
  }>;

  const grouped = new Map<string, TemplateTask[]>();
  for (const row of taskRows) {
    const arr = grouped.get(row.templateId) ?? [];
    arr.push({
      id: row.id,
      templateId: row.templateId,
      phase: row.phase,
      title: row.title,
      description: row.description,
      ownerType: row.ownerType,
      clientVisible: Boolean(row.clientVisible),
      dayOffset: row.dayOffset,
      sortOrder: row.sortOrder,
      dependsOnOrders: JSON.parse(row.dependsOnOrdersJson) as number[],
    });
    grouped.set(row.templateId, arr);
  }

  return templates.map((tpl) => ({
    ...tpl,
    tasks: grouped.get(tpl.id) ?? [],
  }));
}

export function createTemplate(
  ctx: TenantContext,
  input: {
    name: string;
    category: string;
    description: string;
    estimatedDays: number;
    tasks: Array<{
      phase: string;
      title: string;
      description: string;
      ownerType: TaskOwnerType;
      clientVisible: boolean;
      dayOffset: number;
      dependsOnOrders: number[];
    }>;
  }
): ProjectTemplate {
  if (ctx.role === 'CLIENT_USER') {
    throw new HttpError(403, 'RBAC_FORBIDDEN', 'Only internal admins or project managers can author templates.');
  }
  if (!input.name.trim() || input.tasks.length === 0) {
    throw new HttpError(400, 'INVALID_TEMPLATE', 'Template name and at least one task are required.');
  }

  const templateId = `tpl_${crypto.randomUUID().slice(0, 10)}`;
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO project_templates (id, name, category, description, estimated_days, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    templateId,
    input.name.trim(),
    input.category.trim() || 'Enterprise SaaS',
    input.description.trim(),
    Math.max(1, Number(input.estimatedDays) || 30),
    ctx.userName,
    createdAt
  );

  const insertTask = db.prepare(
    `INSERT INTO template_tasks (id, template_id, phase, title, description, owner_type, client_visible, day_offset, sort_order, depends_on_orders_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const createdTasks: TemplateTask[] = [];
  input.tasks.forEach((t, idx) => {
    const sortOrder = idx + 1;
    const taskId = `${templateId}_t${sortOrder}`;
    const deps = t.dependsOnOrders.filter((d) => d > 0 && d < sortOrder);
    insertTask.run(
      taskId,
      templateId,
      t.phase.trim() || 'Phase 1 · Onboarding',
      t.title.trim(),
      t.description.trim(),
      t.ownerType,
      t.clientVisible ? 1 : 0,
      Math.max(1, Number(t.dayOffset) || sortOrder * 3),
      sortOrder,
      JSON.stringify(deps)
    );
    createdTasks.push({
      id: taskId,
      templateId,
      phase: t.phase.trim() || 'Phase 1 · Onboarding',
      title: t.title.trim(),
      description: t.description.trim(),
      ownerType: t.ownerType,
      clientVisible: t.clientVisible,
      dayOffset: Math.max(1, Number(t.dayOffset) || sortOrder * 3),
      sortOrder,
      dependsOnOrders: deps,
    });
  });

  writeAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorName: ctx.userName,
    actorRole: ctx.role,
    eventType: 'TEMPLATE_CREATED',
    entityLabel: input.name.trim(),
    details: `Published reusable onboarding blueprint with ${createdTasks.length} tasks.`,
  });

  return {
    id: templateId,
    name: input.name.trim(),
    category: input.category.trim() || 'Enterprise SaaS',
    description: input.description.trim(),
    estimatedDays: Math.max(1, Number(input.estimatedDays) || 30),
    createdBy: ctx.userName,
    createdAt,
    tasks: createdTasks,
  };
}

export function instantiateProjectFromTemplate(
  ctx: TenantContext,
  input: {
    templateId: string;
    name: string;
    startDate: string;
    health?: ProjectHealth;
  }
): ProjectBoardResponse {
  if (ctx.role === 'CLIENT_USER') {
    throw new HttpError(403, 'RBAC_FORBIDDEN', 'External client users cannot launch projects from templates.');
  }

  const template = listTemplates(ctx).find((t) => t.id === input.templateId);
  if (!template) {
    throw new HttpError(404, 'TEMPLATE_NOT_FOUND', `Template ${input.templateId} not found.`);
  }
  if (!input.name.trim()) {
    throw new HttpError(400, 'INVALID_PROJECT_NAME', 'Project name is required.');
  }

  const startMs = Date.parse(input.startDate || new Date().toISOString().slice(0, 10));
  const safeStartMs = Number.isNaN(startMs) ? Date.now() : startMs;
  const startDate = new Date(safeStartMs).toISOString().slice(0, 10);
  const targetGoLive = new Date(safeStartMs + template.estimatedDays * 86400000).toISOString().slice(0, 10);

  const projectId = `prj_${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, tenant_id, template_id, name, status, start_date, target_go_live, lead_pm_id, lead_pm_name, health, created_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`
  ).run(
    projectId,
    ctx.tenantId,
    template.id,
    input.name.trim(),
    startDate,
    targetGoLive,
    ctx.userId,
    ctx.userName,
    input.health ?? 'ON_TRACK',
    now
  );

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, tenant_id, project_id, phase, title, description, status, owner_type, assignee_name, assignee_role, client_visible, due_date, sort_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'NOT_STARTED', ?, ?, ?, ?, ?, ?, ?)`
  );

  const orderToTaskId = new Map<number, string>();
  for (const tt of template.tasks) {
    const taskId = `tsk_${crypto.randomUUID().slice(0, 10)}`;
    orderToTaskId.set(tt.sortOrder, taskId);
    const dueDate = new Date(safeStartMs + tt.dayOffset * 86400000).toISOString().slice(0, 10);
    const assignee = tt.ownerType === 'CLIENT' ? 'Client Stakeholder' : ctx.userName;
    const assigneeRole: UserRole = tt.ownerType === 'CLIENT' ? 'CLIENT_USER' : 'PROJECT_MANAGER';

    insertTask.run(
      taskId,
      ctx.tenantId,
      projectId,
      tt.phase,
      tt.title,
      tt.description,
      tt.ownerType,
      assignee,
      assigneeRole,
      tt.clientVisible ? 1 : 0,
      dueDate,
      tt.sortOrder,
      now
    );
  }

  const insertDep = db.prepare(
    `INSERT INTO task_dependencies (id, tenant_id, project_id, task_id, depends_on_task_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const tt of template.tasks) {
    const targetId = orderToTaskId.get(tt.sortOrder);
    if (!targetId) continue;
    for (const depOrder of tt.dependsOnOrders) {
      const upstreamId = orderToTaskId.get(depOrder);
      if (upstreamId) {
        insertDep.run(`dep_${crypto.randomUUID().slice(0, 10)}`, ctx.tenantId, projectId, targetId, upstreamId, now);
      }
    }
  }

  writeAuditLog({
    tenantId: ctx.tenantId,
    projectId,
    actorId: ctx.userId,
    actorName: ctx.userName,
    actorRole: ctx.role,
    eventType: 'PROJECT_CREATED',
    toStatus: 'ACTIVE',
    entityLabel: input.name.trim(),
    details: `Instantiated project from template "${template.name}" with ${template.tasks.length} tasks and mapped dependencies.`,
  });

  redisStore.invalidateTenantBoards(ctx.tenantId);
  return getProjectBoard(ctx, projectId);
}

export function listAuditLogs(
  ctx: TenantContext,
  options: { scopeAllTenants?: boolean; projectId?: string; eventType?: string; limit?: number }
): AuditLogEntry[] {
  const limit = Math.min(200, Math.max(10, options.limit ?? 100));
  const useGlobal = options.scopeAllTenants && ctx.role === 'INTERNAL_ADMIN';

  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (!useGlobal) {
    clauses.push('a.tenant_id = ?');
    params.push(ctx.tenantId);
  }
  if (ctx.role === 'CLIENT_USER') {
    // External clients see status transitions & project events for client-visible entities only
    clauses.push("a.event_type IN ('STATUS_TRANSITION', 'PROJECT_CREATED')");
    clauses.push(
      '(a.task_id IS NULL OR EXISTS (SELECT 1 FROM tasks t WHERE t.id = a.task_id AND t.tenant_id = a.tenant_id AND t.client_visible = 1))'
    );
  }
  if (options.projectId) {
    clauses.push('a.project_id = ?');
    params.push(options.projectId);
  }
  if (options.eventType && options.eventType !== 'ALL') {
    clauses.push('a.event_type = ?');
    params.push(options.eventType);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);

  return db
    .prepare(
      `SELECT
        a.id,
        a.tenant_id as tenantId,
        tn.name as tenantName,
        a.project_id as projectId,
        a.task_id as taskId,
        a.actor_id as actorId,
        a.actor_name as actorName,
        a.actor_role as actorRole,
        a.event_type as eventType,
        a.from_status as fromStatus,
        a.to_status as toStatus,
        a.entity_label as entityLabel,
        a.details,
        a.created_at as createdAt
      FROM audit_logs a
      LEFT JOIN tenants tn ON tn.id = a.tenant_id
      ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT ?`
    )
    .all(...params) as unknown as AuditLogEntry[];
}

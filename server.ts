import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { TaskOwnerType, TaskStatus, UserRole } from './shared/types.ts';
import { db, seedDatabaseIfEmpty } from './server/db.ts';
import { redisStore } from './server/redisStore.ts';
import {
  addTaskDependency,
  createTask,
  createTemplate,
  createTenant,
  getProjectBoard,
  getTenantById,
  HttpError,
  instantiateProjectFromTemplate,
  listAccessibleTenants,
  listAllTenants,
  listAuditLogs,
  listProjectsForTenant,
  listTemplates,
  listUsersForWorkspace,
  removeTaskDependency,
  transitionTaskStatus,
  updateTaskDetails,
  writeAuditLog,
} from './server/repository.ts';
import {
  hashPassword,
  issueSessionJwt,
  requireAuth,
  requireRole,
  verifyPassword,
} from './server/security.ts';

dotenv.config();
seedDatabaseIfEmpty();

const app = express();
app.use(express.json({ limit: '1mb' }));

function resolveTenantContext(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
    return;
  }

  const headerTenant = req.header('X-Tenant-ID')?.trim();
  const requestedTenantId = headerTenant || req.auth.tenantId;

  const tenant = getTenantById(requestedTenantId);
  if (!tenant) {
    res.status(404).json({
      error: `Tenant "${requestedTenantId}" does not exist.`,
      code: 'TENANT_NOT_FOUND',
    });
    return;
  }

  const { role, tenantId: tokenTenantId, allowedTenants, sub, name } = req.auth;

  const isAuthorizedForTenant =
    role === 'INTERNAL_ADMIN' ||
    (role === 'PROJECT_MANAGER' && allowedTenants.includes(requestedTenantId)) ||
    (role === 'CLIENT_USER' && tokenTenantId === requestedTenantId);

  if (!isAuthorizedForTenant) {
    writeAuditLog({
      tenantId: tokenTenantId,
      actorId: sub,
      actorName: name,
      actorRole: role,
      eventType: 'ACCESS_DENIED',
      entityLabel: `Tenant Scope: ${requestedTenantId}`,
      details: `Blocked cross-tenant access: ${role} bound to [${allowedTenants.join(', ')}] sent X-Tenant-ID="${requestedTenantId}".`,
    });

    res.status(403).json({
      error: `Tenant isolation violation: ${role} cannot access tenant "${requestedTenantId}".`,
      code: 'TENANT_ISOLATION_VIOLATION',
      jwtTenantId: tokenTenantId,
      requestedTenantId,
    });
    return;
  }

  req.tenantCtx = {
    tenantId: requestedTenantId,
    userId: sub,
    userName: name,
    email: req.auth.email,
    role,
    allowedTenants,
    jti: req.auth.jti,
  };
  next();
}

// ---------- Auth & Session Routes ----------

app.get('/api/auth/personas', (_req: Request, res: Response) => {
  const users = listUsersForWorkspace();
  const tenants = listAllTenants();
  res.json({ users, tenants });
});

app.post('/api/auth/workspace-session', (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'userId is required', code: 'BAD_REQUEST' });
    return;
  }

  const row = db
    .prepare(
      `SELECT id, email, name, role, tenant_id as tenantId, allowed_tenants_json as allowedTenantsJson, title
       FROM users WHERE id = ?`
    )
    .get(userId) as
    | {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        tenantId: string;
        allowedTenantsJson: string;
        title: string;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'Workspace user not found', code: 'USER_NOT_FOUND' });
    return;
  }

  const allowedTenants = JSON.parse(row.allowedTenantsJson) as string[];
  const { token, session } = issueSessionJwt({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    tenantId: row.tenantId,
    allowedTenants,
    title: row.title,
  });

  writeAuditLog({
    tenantId: row.tenantId,
    actorId: row.id,
    actorName: row.name,
    actorRole: row.role,
    eventType: 'SESSION_ISSUED',
    entityLabel: `JWT Session ${session.jti.slice(0, 8)}`,
    details: `Issued HS256 JWT stored in Redis (key session:jwt:${session.jti.slice(0, 8)}...) for ${row.role}.`,
  });

  const accessibleTenants = listAccessibleTenants({
    role: row.role,
    tenantId: row.tenantId,
    allowedTenants,
  });

  res.json({ token, session, accessibleTenants });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required', code: 'BAD_REQUEST' });
    return;
  }

  const row = db
    .prepare(
      `SELECT id, email, name, role, tenant_id as tenantId, allowed_tenants_json as allowedTenantsJson, password_hash as passwordHash, title
       FROM users WHERE LOWER(email) = LOWER(?)`
    )
    .get(email.trim()) as
    | {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        tenantId: string;
        allowedTenantsJson: string;
        passwordHash: string | null;
        title: string;
      }
    | undefined;

  if (!row || !row.passwordHash || !verifyPassword(password, row.passwordHash)) {
    res.status(401).json({
      error: 'Invalid email or password. Use a provisioned credentialed account or workspace session switcher.',
      code: 'INVALID_CREDENTIALS',
    });
    return;
  }

  const allowedTenants = JSON.parse(row.allowedTenantsJson) as string[];
  const { token, session } = issueSessionJwt({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    tenantId: row.tenantId,
    allowedTenants,
    title: row.title,
  });

  writeAuditLog({
    tenantId: row.tenantId,
    actorId: row.id,
    actorName: row.name,
    actorRole: row.role,
    eventType: 'SESSION_ISSUED',
    entityLabel: `JWT Session ${session.jti.slice(0, 8)}`,
    details: `Authenticated via email/password and stored JWT session in Redis.`,
  });

  const accessibleTenants = listAccessibleTenants({
    role: row.role,
    tenantId: row.tenantId,
    allowedTenants,
  });

  res.json({ token, session, accessibleTenants });
});

app.get('/api/auth/me', requireAuth, resolveTenantContext, (req: Request, res: Response) => {
  const auth = req.auth!;
  const ctx = req.tenantCtx!;
  const accessibleTenants = listAccessibleTenants({
    role: auth.role,
    tenantId: auth.tenantId,
    allowedTenants: auth.allowedTenants,
  });
  res.json({
    session: {
      jti: auth.jti,
      userId: auth.sub,
      email: auth.email,
      name: auth.name,
      role: auth.role,
      tenantId: auth.tenantId,
      allowedTenants: auth.allowedTenants,
      title: auth.title,
      issuedAt: new Date(auth.iat * 1000).toISOString(),
      expiresAt: new Date(auth.exp * 1000).toISOString(),
    },
    activeTenantId: ctx.tenantId,
    accessibleTenants,
  });
});

app.post('/api/auth/logout', requireAuth, (req: Request, res: Response) => {
  const auth = req.auth!;
  redisStore.del(`session:jwt:${auth.jti}`);
  writeAuditLog({
    tenantId: auth.tenantId,
    actorId: auth.sub,
    actorName: auth.name,
    actorRole: auth.role,
    eventType: 'SESSION_REVOKED',
    entityLabel: `JWT Session ${auth.jti.slice(0, 8)}`,
    details: 'User signed out; JWT session key evicted from Redis.',
  });
  res.json({ ok: true });
});

// ---------- Tenants & Users ----------

app.get('/api/tenants', requireAuth, resolveTenantContext, (req: Request, res: Response) => {
  const auth = req.auth!;
  res.json({
    tenants: listAccessibleTenants({
      role: auth.role,
      tenantId: auth.tenantId,
      allowedTenants: auth.allowedTenants,
    }),
  });
});

app.post(
  '/api/tenants',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN'),
  (req: Request, res: Response) => {
    const body = req.body as {
      name?: string;
      slug?: string;
      industry?: string;
      tier?: string;
      primaryDomain?: string;
    };
    const tenant = createTenant(req.tenantCtx!, {
      name: body.name ?? '',
      slug: body.slug ?? body.name ?? '',
      industry: body.industry ?? 'Enterprise SaaS',
      tier: body.tier ?? 'Enterprise',
      primaryDomain: body.primaryDomain ?? '',
    });
    res.status(201).json({ tenant });
  }
);

app.get('/api/users', requireAuth, resolveTenantContext, (req: Request, res: Response) => {
  const ctx = req.tenantCtx!;
  if (ctx.role === 'INTERNAL_ADMIN') {
    res.json({ users: listUsersForWorkspace() });
    return;
  }
  res.json({ users: listUsersForWorkspace(ctx.tenantId) });
});

app.post(
  '/api/users',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN'),
  (req: Request, res: Response) => {
    const { email, name, role, tenantId, allowedTenants, title, password } = req.body as {
      email?: string;
      name?: string;
      role?: UserRole;
      tenantId?: string;
      allowedTenants?: string[];
      title?: string;
      password?: string;
    };

    if (!email?.trim() || !name?.trim() || !role || !tenantId) {
      throw new HttpError(400, 'INVALID_USER', 'Email, name, role, and tenantId are required.');
    }

    const validRoles: UserRole[] = ['INTERNAL_ADMIN', 'PROJECT_MANAGER', 'CLIENT_USER'];
    if (!validRoles.includes(role)) {
      throw new HttpError(400, 'INVALID_ROLE', 'Invalid RBAC role.');
    }

    const tenant = getTenantById(tenantId);
    if (!tenant) {
      throw new HttpError(404, 'TENANT_NOT_FOUND', `Tenant ${tenantId} not found.`);
    }

    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
    if (existing) {
      throw new HttpError(409, 'DUPLICATE_EMAIL', `User with email ${email.trim()} already exists.`);
    }

    const scopedAllowed =
      role === 'CLIENT_USER'
        ? [tenantId]
        : Array.isArray(allowedTenants) && allowedTenants.length > 0
          ? Array.from(new Set([tenantId, ...allowedTenants]))
          : [tenantId];

    const userId = `usr_${crypto.randomUUID().slice(0, 10)}`;
    const createdAt = new Date().toISOString();
    const passwordHash = password && password.length >= 6 ? hashPassword(password) : null;

    db.prepare(
      `INSERT INTO users (id, email, name, role, tenant_id, allowed_tenants_json, password_hash, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      email.trim().toLowerCase(),
      name.trim(),
      role,
      tenantId,
      JSON.stringify(scopedAllowed),
      passwordHash,
      title?.trim() || (role === 'CLIENT_USER' ? 'Client Stakeholder' : 'Implementation Specialist'),
      createdAt
    );

    writeAuditLog({
      tenantId,
      actorId: req.tenantCtx!.userId,
      actorName: req.tenantCtx!.userName,
      actorRole: req.tenantCtx!.role,
      eventType: 'SESSION_ISSUED',
      entityLabel: `User: ${name.trim()}`,
      details: `Provisioned ${role} account (${email.trim()}) scoped to [${scopedAllowed.join(', ')}].`,
    });

    res.status(201).json({
      user: {
        id: userId,
        email: email.trim().toLowerCase(),
        name: name.trim(),
        role,
        tenantId,
        allowedTenants: scopedAllowed,
        title: title?.trim() || (role === 'CLIENT_USER' ? 'Client Stakeholder' : 'Implementation Specialist'),
        createdAt,
      },
    });
  }
);

// ---------- Projects & Boards ----------

app.get('/api/projects', requireAuth, resolveTenantContext, (req: Request, res: Response) => {
  const result = listProjectsForTenant(req.tenantCtx!);
  res.json(result);
});

app.post(
  '/api/projects',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN', 'PROJECT_MANAGER'),
  (req: Request, res: Response) => {
    const { templateId, name, startDate, health } = req.body as {
      templateId?: string;
      name?: string;
      startDate?: string;
      health?: 'ON_TRACK' | 'AT_RISK' | 'DELAYED';
    };
    const board = instantiateProjectFromTemplate(req.tenantCtx!, {
      templateId: templateId ?? '',
      name: name ?? '',
      startDate: startDate ?? new Date().toISOString().slice(0, 10),
      health,
    });
    res.status(201).json(board);
  }
);

app.get('/api/projects/:projectId', requireAuth, resolveTenantContext, (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const board = getProjectBoard(req.tenantCtx!, projectId);
  res.json(board);
});

app.post(
  '/api/projects/:projectId/tasks',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN', 'PROJECT_MANAGER'),
  (req: Request, res: Response) => {
    const projectId = String(req.params.projectId);
    const body = req.body as {
      phase?: string;
      title?: string;
      description?: string;
      ownerType?: TaskOwnerType;
      assigneeName?: string;
      clientVisible?: boolean;
      dueDate?: string;
    };
    const task = createTask(req.tenantCtx!, projectId, {
      phase: body.phase ?? 'Phase 1 · Discovery & Kickoff',
      title: body.title ?? '',
      description: body.description ?? '',
      ownerType: body.ownerType === 'CLIENT' ? 'CLIENT' : 'INTERNAL',
      assigneeName: body.assigneeName ?? req.tenantCtx!.userName,
      clientVisible: body.clientVisible ?? true,
      dueDate: body.dueDate ?? '',
    });
    res.status(201).json({ task });
  }
);

// ---------- Tasks & Dependencies ----------

app.patch('/api/tasks/:taskId/transition', requireAuth, resolveTenantContext, (req: Request, res: Response) => {
  const taskId = String(req.params.taskId);
  const { toStatus, reason } = req.body as { toStatus?: TaskStatus; reason?: string };
  if (!toStatus) {
    throw new HttpError(400, 'MISSING_STATUS', 'toStatus is required.');
  }
  const task = transitionTaskStatus(req.tenantCtx!, taskId, toStatus, reason);
  res.json({ task });
});

app.patch(
  '/api/tasks/:taskId',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN', 'PROJECT_MANAGER'),
  (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    const body = req.body as {
      title?: string;
      description?: string;
      assigneeName?: string;
      dueDate?: string;
      clientVisible?: boolean;
      ownerType?: TaskOwnerType;
    };
    const task = updateTaskDetails(req.tenantCtx!, taskId, body);
    res.json({ task });
  }
);

app.post(
  '/api/tasks/:taskId/dependencies',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN', 'PROJECT_MANAGER'),
  (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    const { dependsOnTaskId } = req.body as { dependsOnTaskId?: string };
    if (!dependsOnTaskId) {
      throw new HttpError(400, 'MISSING_DEPENDENCY', 'dependsOnTaskId is required.');
    }
    const task = addTaskDependency(req.tenantCtx!, taskId, dependsOnTaskId);
    res.status(201).json({ task });
  }
);

app.delete(
  '/api/tasks/:taskId/dependencies/:dependencyId',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN', 'PROJECT_MANAGER'),
  (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    const dependencyId = String(req.params.dependencyId);
    const task = removeTaskDependency(req.tenantCtx!, taskId, dependencyId);
    res.json({ task });
  }
);

// ---------- Templates ----------

app.get(
  '/api/templates',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN', 'PROJECT_MANAGER'),
  (req: Request, res: Response) => {
    const templates = listTemplates(req.tenantCtx!);
    res.json({ templates });
  }
);

app.post(
  '/api/templates',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN', 'PROJECT_MANAGER'),
  (req: Request, res: Response) => {
    const body = req.body as {
      name?: string;
      category?: string;
      description?: string;
      estimatedDays?: number;
      tasks?: Array<{
        phase: string;
        title: string;
        description: string;
        ownerType: TaskOwnerType;
        clientVisible: boolean;
        dayOffset: number;
        dependsOnOrders: number[];
      }>;
    };
    const template = createTemplate(req.tenantCtx!, {
      name: body.name ?? '',
      category: body.category ?? 'Enterprise SaaS',
      description: body.description ?? '',
      estimatedDays: body.estimatedDays ?? 30,
      tasks: body.tasks ?? [],
    });
    res.status(201).json({ template });
  }
);

// ---------- Audit Trails ----------

app.get('/api/audit-logs', requireAuth, resolveTenantContext, (req: Request, res: Response) => {
  const scopeAll = req.query.scope === 'all';
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : undefined;
  const logs = listAuditLogs(req.tenantCtx!, {
    scopeAllTenants: scopeAll,
    projectId,
    eventType,
  });
  res.json({ logs });
});

// ---------- Redis Telemetry & Session Controls ----------

app.get('/api/redis/telemetry', requireAuth, resolveTenantContext, (req: Request, res: Response) => {
  const ctx = req.tenantCtx!;
  const filterTenantId = ctx.role === 'INTERNAL_ADMIN' ? null : ctx.tenantId;
  res.json({ telemetry: redisStore.getTelemetry(filterTenantId) });
});

app.post(
  '/api/redis/flush-board-cache',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN', 'PROJECT_MANAGER'),
  (req: Request, res: Response) => {
    const ctx = req.tenantCtx!;
    const removed = redisStore.invalidateTenantBoards(ctx.tenantId);
    writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorName: ctx.userName,
      actorRole: ctx.role,
      eventType: 'CACHE_INVALIDATED',
      entityLabel: `Tenant ${ctx.tenantId} Board Cache`,
      details: `Manual cache flush evicted ${removed} cached Redis key(s).`,
    });
    res.json({ removed, telemetry: redisStore.getTelemetry(ctx.role === 'INTERNAL_ADMIN' ? null : ctx.tenantId) });
  }
);

app.delete(
  '/api/redis/sessions/:jti',
  requireAuth,
  resolveTenantContext,
  requireRole('INTERNAL_ADMIN'),
  (req: Request, res: Response) => {
    const jti = String(req.params.jti);
    const removed = redisStore.del(`session:jwt:${jti}`);
    writeAuditLog({
      tenantId: req.tenantCtx!.tenantId,
      actorId: req.tenantCtx!.userId,
      actorName: req.tenantCtx!.userName,
      actorRole: req.tenantCtx!.role,
      eventType: 'SESSION_REVOKED',
      entityLabel: `JWT Session ${jti.slice(0, 8)}`,
      details: removed
        ? 'Admin remotely revoked JWT session key in Redis.'
        : 'Requested JWT session key was already expired or absent in Redis.',
    });
    res.json({ removed, telemetry: redisStore.getTelemetry(null) });
  }
);

// Central error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
    return;
  }
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

async function startServer(): Promise<void> {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Workflow Engine server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

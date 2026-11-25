import type {
  AuditLogEntry,
  OnboardingTask,
  ProjectBoardResponse,
  ProjectSummary,
  ProjectTemplate,
  RedisTelemetry,
  SessionInfo,
  TaskOwnerType,
  TaskStatus,
  Tenant,
  UserAccount,
  UserRole,
} from '../shared/types.ts';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(
  url: string,
  options: {
    method?: string;
    token?: string | null;
    tenantId?: string | null;
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  if (options.tenantId) {
    headers['X-Tenant-ID'] = options.tenantId;
  }

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.code || 'REQUEST_FAILED',
      data.error || `Request failed with HTTP ${res.status}`,
      data.details
    );
  }
  return data as T;
}

export const api = {
  getPersonas() {
    return request<{ users: UserAccount[]; tenants: Tenant[] }>('/api/auth/personas');
  },

  createWorkspaceSession(userId: string) {
    return request<{ token: string; session: SessionInfo; accessibleTenants: Tenant[] }>(
      '/api/auth/workspace-session',
      { method: 'POST', body: { userId } }
    );
  },

  loginWithPassword(email: string, password: string) {
    return request<{ token: string; session: SessionInfo; accessibleTenants: Tenant[] }>(
      '/api/auth/login',
      { method: 'POST', body: { email, password } }
    );
  },

  logout(token: string) {
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', token });
  },

  getMe(token: string, tenantId: string) {
    return request<{ session: SessionInfo; activeTenantId: string; accessibleTenants: Tenant[] }>(
      '/api/auth/me',
      { token, tenantId }
    );
  },

  listTenants(token: string, tenantId: string) {
    return request<{ tenants: Tenant[] }>('/api/tenants', { token, tenantId });
  },

  createTenant(
    token: string,
    tenantId: string,
    payload: { name: string; slug: string; industry: string; tier: string; primaryDomain: string }
  ) {
    return request<{ tenant: Tenant }>('/api/tenants', {
      method: 'POST',
      token,
      tenantId,
      body: payload,
    });
  },

  listUsers(token: string, tenantId: string) {
    return request<{ users: UserAccount[] }>('/api/users', { token, tenantId });
  },

  createUser(
    token: string,
    tenantId: string,
    payload: {
      email: string;
      name: string;
      role: UserRole;
      tenantId: string;
      allowedTenants?: string[];
      title?: string;
      password?: string;
    }
  ) {
    return request<{ user: UserAccount }>('/api/users', {
      method: 'POST',
      token,
      tenantId,
      body: payload,
    });
  },

  listProjects(token: string, tenantId: string) {
    return request<{ projects: ProjectSummary[]; cacheStatus: 'HIT' | 'MISS' }>('/api/projects', {
      token,
      tenantId,
    });
  },

  createProject(
    token: string,
    tenantId: string,
    payload: { templateId: string; name: string; startDate: string }
  ) {
    return request<ProjectBoardResponse>('/api/projects', {
      method: 'POST',
      token,
      tenantId,
      body: payload,
    });
  },

  getProjectBoard(token: string, tenantId: string, projectId: string) {
    return request<ProjectBoardResponse>(`/api/projects/${encodeURIComponent(projectId)}`, {
      token,
      tenantId,
    });
  },

  createTask(
    token: string,
    tenantId: string,
    projectId: string,
    payload: {
      phase: string;
      title: string;
      description: string;
      ownerType: TaskOwnerType;
      assigneeName: string;
      clientVisible: boolean;
      dueDate: string;
    }
  ) {
    return request<{ task: OnboardingTask }>(
      `/api/projects/${encodeURIComponent(projectId)}/tasks`,
      { method: 'POST', token, tenantId, body: payload }
    );
  },

  transitionTaskStatus(
    token: string,
    tenantId: string,
    taskId: string,
    toStatus: TaskStatus,
    reason?: string
  ) {
    return request<{ task: OnboardingTask }>(
      `/api/tasks/${encodeURIComponent(taskId)}/transition`,
      { method: 'PATCH', token, tenantId, body: { toStatus, reason } }
    );
  },

  updateTask(
    token: string,
    tenantId: string,
    taskId: string,
    updates: {
      title?: string;
      description?: string;
      assigneeName?: string;
      dueDate?: string;
      clientVisible?: boolean;
      ownerType?: TaskOwnerType;
    }
  ) {
    return request<{ task: OnboardingTask }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      token,
      tenantId,
      body: updates,
    });
  },

  addDependency(token: string, tenantId: string, taskId: string, dependsOnTaskId: string) {
    return request<{ task: OnboardingTask }>(
      `/api/tasks/${encodeURIComponent(taskId)}/dependencies`,
      { method: 'POST', token, tenantId, body: { dependsOnTaskId } }
    );
  },

  removeDependency(token: string, tenantId: string, taskId: string, dependencyId: string) {
    return request<{ task: OnboardingTask }>(
      `/api/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(dependencyId)}`,
      { method: 'DELETE', token, tenantId }
    );
  },

  listTemplates(token: string, tenantId: string) {
    return request<{ templates: ProjectTemplate[] }>('/api/templates', { token, tenantId });
  },

  createTemplate(
    token: string,
    tenantId: string,
    payload: {
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
  ) {
    return request<{ template: ProjectTemplate }>('/api/templates', {
      method: 'POST',
      token,
      tenantId,
      body: payload,
    });
  },

  listAuditLogs(
    token: string,
    tenantId: string,
    params: { scopeAll?: boolean; projectId?: string; eventType?: string } = {}
  ) {
    const query = new URLSearchParams();
    if (params.scopeAll) query.set('scope', 'all');
    if (params.projectId) query.set('projectId', params.projectId);
    if (params.eventType) query.set('eventType', params.eventType);
    const qs = query.toString();
    return request<{ logs: AuditLogEntry[] }>(`/api/audit-logs${qs ? `?${qs}` : ''}`, {
      token,
      tenantId,
    });
  },

  getRedisTelemetry(token: string, tenantId: string) {
    return request<{ telemetry: RedisTelemetry }>('/api/redis/telemetry', { token, tenantId });
  },

  flushBoardCache(token: string, tenantId: string) {
    return request<{ removed: number; telemetry: RedisTelemetry }>(
      '/api/redis/flush-board-cache',
      { method: 'POST', token, tenantId }
    );
  },

  revokeSession(token: string, tenantId: string, jti: string) {
    return request<{ removed: boolean; telemetry: RedisTelemetry }>(
      `/api/redis/sessions/${encodeURIComponent(jti)}`,
      { method: 'DELETE', token, tenantId }
    );
  },

  async probeTenantIsolation(token: string, targetTenantId: string, projectId?: string) {
    const url = projectId
      ? `/api/projects/${encodeURIComponent(projectId)}`
      : '/api/projects';
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': targetTenantId,
      },
    });
    const body = await res.json().catch(() => ({}));
    return {
      status: res.status,
      ok: res.ok,
      body,
    };
  },
};

export type UserRole = 'INTERNAL_ADMIN' | 'PROJECT_MANAGER' | 'CLIENT_USER';

export type TaskStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'BLOCKED'
  | 'COMPLETED';

export type TaskOwnerType = 'INTERNAL' | 'CLIENT';

export type ProjectHealth = 'ON_TRACK' | 'AT_RISK' | 'DELAYED';

export type AuditEventType =
  | 'STATUS_TRANSITION'
  | 'DEPENDENCY_ADDED'
  | 'DEPENDENCY_REMOVED'
  | 'PROJECT_CREATED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TEMPLATE_CREATED'
  | 'SESSION_ISSUED'
  | 'SESSION_REVOKED'
  | 'CACHE_INVALIDATED'
  | 'ACCESS_DENIED';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  industry: string;
  tier: string;
  primaryDomain: string;
  createdAt: string;
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  allowedTenants: string[];
  title: string;
  createdAt: string;
}

export interface SessionInfo {
  jti: string;
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  allowedTenants: string[];
  title: string;
  issuedAt: string;
  expiresAt: string;
}

export interface TemplateTask {
  id: string;
  templateId: string;
  phase: string;
  title: string;
  description: string;
  ownerType: TaskOwnerType;
  clientVisible: boolean;
  dayOffset: number;
  sortOrder: number;
  dependsOnOrders: number[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  estimatedDays: number;
  createdBy: string;
  createdAt: string;
  tasks: TemplateTask[];
}

export interface ProjectSummary {
  id: string;
  tenantId: string;
  tenantName?: string;
  templateId: string | null;
  templateName?: string | null;
  name: string;
  status: string;
  startDate: string;
  targetGoLive: string;
  leadPmId: string;
  leadPmName: string;
  health: ProjectHealth;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  createdAt: string;
}

export interface TaskDependency {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  dependsOnTitle: string;
  dependsOnStatus: TaskStatus;
  dependsOnPhase: string;
}

export interface OnboardingTask {
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
  clientVisible: boolean;
  dueDate: string;
  sortOrder: number;
  updatedAt: string;
  dependencies: TaskDependency[];
  blockingCount: number;
  isDependencyBlocked: boolean;
}

export interface ProjectBoardResponse {
  project: ProjectSummary;
  tasks: OnboardingTask[];
  cache: {
    status: 'HIT' | 'MISS';
    key: string;
    ttlRemainingSeconds: number;
    cachedAt: string;
  };
}

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  tenantName?: string;
  projectId: string | null;
  taskId: string | null;
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'SYSTEM';
  eventType: AuditEventType;
  fromStatus: string | null;
  toStatus: string | null;
  entityLabel: string;
  details: string;
  createdAt: string;
}

export interface RedisKeyEntry {
  key: string;
  namespace: 'session' | 'board' | 'projects';
  tenantId: string | null;
  ttlRemainingSeconds: number;
  createdAt: string;
  expiresAt: string;
  preview: string;
}

export interface RedisTelemetry {
  engine: string;
  activeKeys: number;
  activeSessions: number;
  cachedBoards: number;
  hits: number;
  misses: number;
  invalidations: number;
  hitRatePercent: number;
  entries: RedisKeyEntry[];
}

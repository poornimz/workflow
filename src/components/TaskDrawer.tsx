import { useEffect, useState } from 'react';
import { GitBranch, Lock, Plus, Trash2, X } from 'lucide-react';
import type {
  AuditLogEntry,
  OnboardingTask,
  TaskOwnerType,
  TaskStatus,
  UserRole,
} from '../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import {
  formatRoleLabel,
  formatShortDate,
  formatTimestamp,
  STATUS_META,
  TaskStatusInline,
} from './StatusLabel.tsx';

interface TaskDrawerProps {
  task: OnboardingTask | null;
  allProjectTasks: OnboardingTask[];
  token: string;
  tenantId: string;
  userRole: UserRole;
  onClose: () => void;
  onTaskUpdated: () => void;
}

const ALL_STATUSES: TaskStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
  'COMPLETED',
];

export function TaskDrawer({
  task,
  allProjectTasks,
  token,
  tenantId,
  userRole,
  onClose,
  onTaskUpdated,
}: TaskDrawerProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDepId, setSelectedDepId] = useState('');
  const [taskLogs, setTaskLogs] = useState<AuditLogEntry[]>([]);

  const [editing, setEditing] = useState(false);
  const [editAssignee, setEditAssignee] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editOwnerType, setEditOwnerType] = useState<TaskOwnerType>('INTERNAL');
  const [editClientVisible, setEditClientVisible] = useState(true);

  useEffect(() => {
    if (!task) return;
    setError(null);
    setReason('');
    setEditing(false);
    setEditAssignee(task.assigneeName);
    setEditDueDate(task.dueDate);
    setEditOwnerType(task.ownerType);
    setEditClientVisible(task.clientVisible);

    const existingDepIds = new Set(task.dependencies.map((d) => d.dependsOnTaskId));
    const candidates = allProjectTasks.filter(
      (t) => t.id !== task.id && !existingDepIds.has(t.id)
    );
    setSelectedDepId(candidates[0]?.id ?? '');

    api
      .listAuditLogs(token, tenantId, { projectId: task.projectId })
      .then((res) => {
        setTaskLogs(res.logs.filter((l) => l.taskId === task.id));
      })
      .catch(() => {
        setTaskLogs([]);
      });
  }, [task, token, tenantId, allProjectTasks]);

  if (!task) return null;

  const isManagerOrAdmin = userRole === 'INTERNAL_ADMIN' || userRole === 'PROJECT_MANAGER';
  const canClientTransition = userRole === 'CLIENT_USER' && task.ownerType === 'CLIENT';
  const canTransition = isManagerOrAdmin || canClientTransition;

  const existingDepIds = new Set(task.dependencies.map((d) => d.dependsOnTaskId));
  const candidateDependencies = allProjectTasks.filter(
    (t) => t.id !== task.id && !existingDepIds.has(t.id)
  );

  async function handleTransition(nextStatus: TaskStatus) {
    if (!task || nextStatus === task.status) return;
    setError(null);
    setBusy(true);
    try {
      await api.transitionTaskStatus(token, tenantId, task.id, nextStatus, reason);
      setReason('');
      onTaskUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Status transition failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddDependency() {
    if (!task || !selectedDepId) return;
    setError(null);
    setBusy(true);
    try {
      await api.addDependency(token, tenantId, task.id, selectedDepId);
      onTaskUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to link dependency.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveDependency(depId: string) {
    if (!task) return;
    setError(null);
    setBusy(true);
    try {
      await api.removeDependency(token, tenantId, task.id, depId);
      onTaskUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to remove dependency.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!task) return;
    setError(null);
    setBusy(true);
    try {
      await api.updateTask(token, tenantId, task.id, {
        assigneeName: editAssignee,
        dueDate: editDueDate,
        ownerType: editOwnerType,
        clientVisible: editClientVisible,
      });
      setEditing(false);
      onTaskUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update task.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/35 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-task-title"
    >
      <div className="w-full max-w-xl bg-white h-full border-l border-slate-200 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span>{task.phase}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{task.id}</span>
            </div>
            <h2
              id="drawer-task-title"
              className="font-display text-base font-semibold text-slate-900"
            >
              {task.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task details"
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div
              role="alert"
              className="px-3.5 py-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 leading-relaxed"
            >
              {error}
            </div>
          )}

          {/* Description & Metadata */}
          <section className="space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">{task.description}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-200 text-xs">
              <div>
                <div className="text-slate-500">Current State</div>
                <div className="mt-1">
                  <TaskStatusInline
                    status={task.status}
                    isGated={task.isDependencyBlocked}
                  />
                </div>
              </div>
              <div>
                <div className="text-slate-500">Owner</div>
                <div className="mt-1 font-medium text-slate-900">
                  {task.assigneeName} ({task.ownerType === 'CLIENT' ? 'Client' : 'Internal'})
                </div>
              </div>
              <div>
                <div className="text-slate-500">Due Date</div>
                <div className="mt-1 font-mono tabular-nums text-slate-900">
                  {formatShortDate(task.dueDate)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Visibility</div>
                <div className="mt-1 font-medium text-slate-900">
                  {task.clientVisible ? 'Client Portal' : 'Internal Only'}
                </div>
              </div>
            </div>

            {isManagerOrAdmin && !editing && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Edit assignee, due date, or visibility
                </button>
              </div>
            )}

            {editing && isManagerOrAdmin && (
              <form
                onSubmit={handleSaveDetails}
                className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Assignee
                    </label>
                    <input
                      type="text"
                      value={editAssignee}
                      onChange={(e) => setEditAssignee(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Owner Group
                    </label>
                    <select
                      value={editOwnerType}
                      onChange={(e) => setEditOwnerType(e.target.value as TaskOwnerType)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    >
                      <option value="INTERNAL">Internal Team</option>
                      <option value="CLIENT">Client Team</option>
                    </select>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editClientVisible}
                        onChange={(e) => setEditClientVisible(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      />
                      Visible in Client Portal
                    </label>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* Status Transition */}
          <section className="pt-5 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900">
                Workflow Status Transition
              </h3>
              {task.isDependencyBlocked && task.status !== 'COMPLETED' && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  Blocked by upstream task
                </span>
              )}
            </div>

            {!canTransition ? (
              <p className="text-xs text-slate-500">
                This milestone is owned by the internal implementation team. External client users
                can transition client-owned tasks only.
              </p>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Optional audit note for this transition (e.g., UAT sign-off verified)"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <div className="flex flex-wrap gap-2">
                  {ALL_STATUSES.map((st) => {
                    const active = task.status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        disabled={busy || active}
                        onClick={() => handleTransition(st)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                        } disabled:opacity-60`}
                      >
                        {STATUS_META[st].label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Dependencies */}
          <section className="pt-5 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900 inline-flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                Upstream Dependencies ({task.dependencies.length})
              </h3>
            </div>

            {task.dependencies.length === 0 ? (
              <p className="text-xs text-slate-500">
                No upstream blockers. This task can start independently.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {task.dependencies.map((dep) => (
                  <div
                    key={dep.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-white text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">
                        {dep.dependsOnTitle}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-slate-500">
                        <span>{dep.dependsOnPhase}</span>
                        <span aria-hidden="true">·</span>
                        <TaskStatusInline status={dep.dependsOnStatus} />
                      </div>
                    </div>
                    {isManagerOrAdmin && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRemoveDependency(dep.id)}
                        aria-label={`Remove dependency ${dep.dependsOnTitle}`}
                        className="p-1.5 text-slate-400 hover:text-rose-700 rounded-md hover:bg-rose-50 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {isManagerOrAdmin && candidateDependencies.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={selectedDepId}
                  onChange={(e) => setSelectedDepId(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  {candidateDependencies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.phase} — {c.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !selectedDepId}
                  onClick={handleAddDependency}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Blocker
                </button>
              </div>
            )}
          </section>

          {/* Task Audit History */}
          <section className="pt-5 border-t border-slate-200 space-y-3">
            <h3 className="text-xs font-semibold text-slate-900">
              Task Audit Trail ({taskLogs.length})
            </h3>
            {taskLogs.length === 0 ? (
              <p className="text-xs text-slate-500">No recorded transitions for this task yet.</p>
            ) : (
              <div className="space-y-2.5">
                {taskLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">
                        {log.actorName} · {formatRoleLabel(log.actorRole)}
                      </span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {formatTimestamp(log.createdAt)}
                      </span>
                    </div>
                    {log.fromStatus && log.toStatus && (
                      <div className="font-mono text-slate-700">
                        {log.fromStatus} → {log.toStatus}
                      </div>
                    )}
                    <p className="text-slate-600">{log.details}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

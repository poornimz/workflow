import { useState } from 'react';
import {
  ChevronRight,
  Database,
  GitBranch,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import type {
  OnboardingTask,
  ProjectBoardResponse,
  ProjectSummary,
  TaskOwnerType,
  TaskStatus,
  UserRole,
} from '../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import {
  formatShortDate,
  HealthInline,
  STATUS_META,
  TaskStatusInline,
} from './StatusLabel.tsx';
import { TaskDrawer } from './TaskDrawer.tsx';

interface ProjectWorkspaceProps {
  token: string;
  tenantId: string;
  userRole: UserRole;
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  board: ProjectBoardResponse | null;
  loadingBoard: boolean;
  onSelectProject: (projectId: string) => void;
  onRefreshBoard: () => void;
  onOpenNewProject: () => void;
}

const BOARD_COLUMNS: TaskStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
  'COMPLETED',
];

export function ProjectWorkspace({
  token,
  tenantId,
  userRole,
  projects,
  selectedProjectId,
  board,
  loadingBoard,
  onSelectProject,
  onRefreshBoard,
  onOpenNewProject,
}: ProjectWorkspaceProps) {
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPhase, setNewTaskPhase] = useState('Phase 2 · Identity & Data Setup');
  const [newTaskOwner, setNewTaskOwner] = useState<TaskOwnerType>('CLIENT');
  const [newTaskDueDate, setNewTaskDueDate] = useState(() =>
    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  );
  const [newTaskClientVisible, setNewTaskClientVisible] = useState(true);
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isManagerOrAdmin = userRole === 'INTERNAL_ADMIN' || userRole === 'PROJECT_MANAGER';

  const tasks = board?.tasks ?? [];
  const filteredTasks = tasks.filter((t) => {
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.phase.toLowerCase().includes(q) ||
        t.assigneeName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  // Group tasks by phase for Rocketlane-style phase view
  const phases = Array.from(new Set(filteredTasks.map((t) => t.phase)));

  async function handleQuickTransition(task: OnboardingTask, toStatus: TaskStatus) {
    setActionError(null);
    try {
      await api.transitionTaskStatus(token, tenantId, task.id, toStatus);
      onRefreshBoard();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to transition task status.');
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProjectId) return;
    setActionError(null);
    setAddingTask(true);
    try {
      await api.createTask(token, tenantId, selectedProjectId, {
        phase: newTaskPhase,
        title: newTaskTitle,
        description: newTaskDesc || 'Onboarding milestone task.',
        ownerType: newTaskOwner,
        assigneeName: newTaskOwner === 'CLIENT' ? 'Client Stakeholder' : 'Implementation Lead',
        clientVisible: newTaskClientVisible,
        dueDate: newTaskDueDate,
      });
      setNewTaskTitle('');
      setNewTaskDesc('');
      setShowAddTask(false);
      onRefreshBoard();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to create task.');
    } finally {
      setAddingTask(false);
    }
  }

  if (projects.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
        <h2 className="font-display text-lg font-semibold text-slate-900">
          No onboarding projects in this tenant
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Launch an onboarding project from a reusable template to track customer milestones,
          dependency gates, and audit history.
        </p>
        {isManagerOrAdmin && (
          <button
            type="button"
            onClick={onOpenNewProject}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create First Project
          </button>
        )}
      </div>
    );
  }

  const project = board?.project;
  const completionPct =
    project && project.totalTasks > 0
      ? Math.round((project.completedTasks / project.totalTasks) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Project Switcher & Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {projects.map((p) => {
              const active = p.id === selectedProjectId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectProject(p.id)}
                  className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {board?.cache && (
              <div className="inline-flex items-center gap-2 text-xs text-slate-600 font-mono tabular-nums">
                <Database className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                <span>
                  Redis: {board.cache.status} · {board.cache.ttlRemainingSeconds}s TTL
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={onRefreshBoard}
              aria-label="Refresh project board"
              className="p-2 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingBoard ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {project && (
          <div className="pt-4 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-5 gap-6">
            <div>
              <div className="text-xs text-slate-500">Project Health</div>
              <div className="mt-1">
                <HealthInline health={project.health} />
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Target Go-Live</div>
              <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
                {formatShortDate(project.targetGoLive)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Lead Architect</div>
              <div className="mt-1 text-sm font-medium text-slate-900 truncate">
                {project.leadPmName}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Completion</div>
              <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
                {project.completedTasks}/{project.totalTasks} tasks ({completionPct}%)
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Gated / Blocked</div>
              <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
                {project.blockedTasks} task{project.blockedTasks === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        )}
      </div>

      {actionError && (
        <div
          role="alert"
          className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-4"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-700 font-medium hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Workspace Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tasks, phases, or owners..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | TaskStatus)}
            aria-label="Filter by task status"
            className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-700"
          >
            <option value="ALL">All Statuses</option>
            {BOARD_COLUMNS.map((st) => (
              <option key={st} value={st}>
                {STATUS_META[st].label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'list'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Phases
            </button>
            <button
              type="button"
              onClick={() => setViewMode('board')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'board'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Board
            </button>
          </div>

          {isManagerOrAdmin && (
            <button
              type="button"
              onClick={() => setShowAddTask((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Task
            </button>
          )}
        </div>
      </div>

      {/* Inline Add Task Form */}
      {showAddTask && isManagerOrAdmin && (
        <form
          onSubmit={handleCreateTask}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Add Milestone Task
            </h3>
            <button
              type="button"
              onClick={() => setShowAddTask(false)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              required
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Task title"
              className="sm:col-span-2 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              value={newTaskPhase}
              onChange={(e) => setNewTaskPhase(e.target.value)}
              placeholder="Phase name"
              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            />
            <input
              type="date"
              value={newTaskDueDate}
              onChange={(e) => setNewTaskDueDate(e.target.value)}
              className="px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
              <select
                value={newTaskOwner}
                onChange={(e) => setNewTaskOwner(e.target.value as TaskOwnerType)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="CLIENT">Owner: Client Team</option>
                <option value="INTERNAL">Owner: Internal Team</option>
              </select>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newTaskClientVisible}
                  onChange={(e) => setNewTaskClientVisible(e.target.checked)}
                />
                Client-visible milestone
              </label>
            </div>
            <button
              type="submit"
              disabled={addingTask}
              className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap"
            >
              {addingTask ? 'Saving...' : 'Create Task'}
            </button>
          </div>
        </form>
      )}

      {/* Loading / Empty / Content */}
      {loadingBoard && !board ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="h-5 w-48 bg-slate-100 rounded" />
          <div className="h-10 w-full bg-slate-100 rounded" />
          <div className="h-10 w-full bg-slate-100 rounded" />
          <div className="h-10 w-full bg-slate-100 rounded" />
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          No tasks match the active filter criteria.
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-4">
          {phases.map((phase) => {
            const phaseTasks = filteredTasks.filter((t) => t.phase === phase);
            const doneCount = phaseTasks.filter((t) => t.status === 'COMPLETED').length;

            return (
              <div
                key={phase}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden"
              >
                <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between gap-4">
                  <h3 className="font-display text-xs font-semibold text-slate-900">
                    {phase}
                  </h3>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {doneCount}/{phaseTasks.length} completed
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                        <th className="py-2.5 pl-5 pr-3">Task & Dependencies</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Owner</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Visibility</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                        <th className="py-2.5 pl-3 pr-5 text-right whitespace-nowrap">Due Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {phaseTasks.map((task) => {
                        const unmetDeps = task.dependencies.filter(
                          (d) => d.dependsOnStatus !== 'COMPLETED'
                        );
                        return (
                          <tr
                            key={task.id}
                            onClick={() => setSelectedTaskId(task.id)}
                            className="hover:bg-slate-50 cursor-pointer transition-colors"
                          >
                            <td className="py-3 pl-5 pr-3 max-w-md">
                              <div className="font-medium text-slate-900 flex items-center gap-2">
                                <span>{task.title}</span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                              </div>
                              {task.dependencies.length > 0 && (
                                <div className="mt-1 flex items-center gap-1.5 text-slate-500">
                                  <GitBranch className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span>
                                    Depends on {task.dependencies.length} task
                                    {task.dependencies.length > 1 ? 's' : ''}
                                    {unmetDeps.length > 0
                                      ? ` · Waiting on "${unmetDeps[0].dependsOnTitle}"`
                                      : ' · Prerequisites met'}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap text-slate-700">
                              {task.assigneeName}
                              <span className="text-slate-400">
                                {' '}
                                · {task.ownerType === 'CLIENT' ? 'Client' : 'Internal'}
                              </span>
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap text-slate-600">
                              {task.clientVisible ? 'Client Portal' : 'Internal Only'}
                            </td>
                            <td
                              className="py-3 px-3 whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isManagerOrAdmin ||
                              (userRole === 'CLIENT_USER' && task.ownerType === 'CLIENT') ? (
                                <select
                                  aria-label={`Change status for ${task.title}`}
                                  value={task.status}
                                  onChange={(e) =>
                                    handleQuickTransition(task, e.target.value as TaskStatus)
                                  }
                                  className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-md text-slate-800 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600"
                                >
                                  {BOARD_COLUMNS.map((st) => (
                                    <option key={st} value={st}>
                                      {STATUS_META[st].label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <TaskStatusInline
                                  status={task.status}
                                  isGated={task.isDependencyBlocked}
                                />
                              )}
                            </td>
                            <td className="py-3 pl-3 pr-5 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                              {formatShortDate(task.dueDate)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Kanban Board View */
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4 items-start">
          {BOARD_COLUMNS.map((colStatus) => {
            const colTasks = filteredTasks.filter((t) => t.status === colStatus);
            return (
              <div
                key={colStatus}
                className="bg-slate-100/80 border border-slate-200 rounded-xl p-3 space-y-2.5 min-h-[260px]"
              >
                <div className="flex items-center justify-between px-1 pb-1">
                  <TaskStatusInline status={colStatus} />
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {colTasks.length}
                  </span>
                </div>

                {colTasks.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">Empty</div>
                ) : (
                  colTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setSelectedTaskId(task.id)}
                      className="w-full text-left bg-white border border-slate-200 hover:border-slate-300 rounded-lg p-3 space-y-2 transition-colors"
                    >
                      <div className="text-xs text-slate-500 truncate">{task.phase}</div>
                      <div className="text-xs font-medium text-slate-900 leading-snug">
                        {task.title}
                      </div>
                      <div className="pt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="truncate">
                          {task.ownerType === 'CLIENT' ? 'Client' : 'Internal'}
                        </span>
                        <span className="font-mono tabular-nums shrink-0">
                          {formatShortDate(task.dueDate)}
                        </span>
                      </div>
                      {task.isDependencyBlocked && task.status !== 'COMPLETED' && (
                        <div className="text-xs text-amber-700 font-medium">
                          Blocked by dependency
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      <TaskDrawer
        task={selectedTask}
        allProjectTasks={tasks}
        token={token}
        tenantId={tenantId}
        userRole={userRole}
        onClose={() => setSelectedTaskId(null)}
        onTaskUpdated={onRefreshBoard}
      />
    </div>
  );
}

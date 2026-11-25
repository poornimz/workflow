import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  ClipboardList,
  FolderKanban,
  Layers,
  Lock,
  LogOut,
  Menu,
  Plus,
  Shield,
  Users,
  X,
} from 'lucide-react';
import type {
  ProjectBoardResponse,
  ProjectSummary,
  SessionInfo,
  Tenant,
  UserAccount,
} from '../shared/types.ts';
import { api, ApiError } from './api.ts';
import { AuditTrailView } from './components/AuditTrailView.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { CreateProjectModal } from './components/CreateProjectModal.tsx';
import { ProjectWorkspace } from './components/ProjectWorkspace.tsx';
import { formatRoleLabel } from './components/StatusLabel.tsx';
import { TemplatesView } from './components/TemplatesView.tsx';
import { TenantSecurityConsole } from './components/TenantSecurityConsole.tsx';

type NavTab = 'projects' | 'templates' | 'audit' | 'security';

export default function App() {
  // Strictly in-memory session state (never localStorage/sessionStorage)
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [accessibleTenants, setAccessibleTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string>('');

  const [personas, setPersonas] = useState<UserAccount[]>([]);
  const [allKnownTenants, setAllKnownTenants] = useState<Tenant[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('projects');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sessionBanner, setSessionBanner] = useState<string | null>(null);

  // Projects & Board state
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [board, setBoard] = useState<ProjectBoardResponse | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);

  // Create project modal
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [launchTemplateId, setLaunchTemplateId] = useState<string | undefined>(undefined);

  const loadDirectory = useCallback(async () => {
    setLoadingPersonas(true);
    setDirectoryError(null);
    try {
      const res = await api.getPersonas();
      setPersonas(res.users);
      setAllKnownTenants(res.tenants);
    } catch (err) {
      setDirectoryError(
        err instanceof ApiError
          ? err.message
          : 'Unable to reach the Workflow Engine API server. Ensure `npm run dev` is running on port 3000.'
      );
    } finally {
      setLoadingPersonas(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const handleSessionInvalidated = useCallback((message: string) => {
    setToken(null);
    setSession(null);
    setAccessibleTenants([]);
    setActiveTenantId('');
    setProjects([]);
    setBoard(null);
    setSelectedProjectId(null);
    setSessionBanner(message);
  }, []);

  const loadTenantProjects = useCallback(
    async (authToken: string, tenantId: string, preferredProjectId?: string | null) => {
      setLoadingBoard(true);
      try {
        const res = await api.listProjects(authToken, tenantId);
        setProjects(res.projects);
        const nextId =
          preferredProjectId && res.projects.some((p) => p.id === preferredProjectId)
            ? preferredProjectId
            : res.projects[0]?.id ?? null;
        setSelectedProjectId(nextId);
        if (nextId) {
          const boardRes = await api.getProjectBoard(authToken, tenantId, nextId);
          setBoard(boardRes);
        } else {
          setBoard(null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleSessionInvalidated(err.message);
        }
      } finally {
        setLoadingBoard(false);
      }
    },
    [handleSessionInvalidated]
  );

  const handleAuthenticated = useCallback(
    (payload: { token: string; session: SessionInfo; accessibleTenants: Tenant[] }) => {
      setSessionBanner(null);
      setToken(payload.token);
      setSession(payload.session);
      setAccessibleTenants(payload.accessibleTenants);
      const initialTenant = payload.session.tenantId;
      setActiveTenantId(initialTenant);
      setActiveTab('projects');
      loadTenantProjects(payload.token, initialTenant, null);
    },
    [loadTenantProjects]
  );

  const handleSelectTenant = useCallback(
    (nextTenantId: string) => {
      if (!token || nextTenantId === activeTenantId) return;
      setActiveTenantId(nextTenantId);
      setSelectedProjectId(null);
      setBoard(null);
      loadTenantProjects(token, nextTenantId, null);
    },
    [token, activeTenantId, loadTenantProjects]
  );

  const handleSelectProject = useCallback(
    async (projectId: string) => {
      if (!token || !activeTenantId) return;
      setSelectedProjectId(projectId);
      setLoadingBoard(true);
      try {
        const boardRes = await api.getProjectBoard(token, activeTenantId, projectId);
        setBoard(boardRes);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleSessionInvalidated(err.message);
        }
      } finally {
        setLoadingBoard(false);
      }
    },
    [token, activeTenantId, handleSessionInvalidated]
  );

  const handleRefreshBoard = useCallback(() => {
    if (!token || !activeTenantId) return;
    loadTenantProjects(token, activeTenantId, selectedProjectId);
  }, [token, activeTenantId, selectedProjectId, loadTenantProjects]);

  const handleSignOut = async () => {
    if (token) {
      await api.logout(token).catch(() => {});
    }
    handleSessionInvalidated('Signed out and evicted JWT session from Redis.');
  };

  const handleQuickSwitchPersona = async (userId: string) => {
    try {
      const result = await api.createWorkspaceSession(userId);
      handleAuthenticated(result);
      setMobileNavOpen(false);
    } catch {
      // ignore
    }
  };

  if (!token || !session) {
    return (
      <div>
        {sessionBanner && (
          <div className="bg-slate-900 text-white text-xs px-6 py-2.5 text-center">
            {sessionBanner}
          </div>
        )}
        <AuthGate
          personas={personas}
          tenants={allKnownTenants}
          loadingPersonas={loadingPersonas}
          directoryError={directoryError}
          onRetryDirectory={loadDirectory}
          onAuthenticated={handleAuthenticated}
        />
      </div>
    );
  }

  const activeTenant =
    accessibleTenants.find((t) => t.id === activeTenantId) ?? accessibleTenants[0];
  const isManagerOrAdmin =
    session.role === 'INTERNAL_ADMIN' || session.role === 'PROJECT_MANAGER';

  const navItems: Array<{ id: NavTab; label: string; Icon: typeof FolderKanban; hidden?: boolean }> = [
    { id: 'projects', label: 'Onboarding Projects', Icon: FolderKanban },
    {
      id: 'templates',
      label: 'Project Templates',
      Icon: Layers,
      hidden: session.role === 'CLIENT_USER',
    },
    { id: 'audit', label: 'Audit Trails', Icon: ClipboardList },
    { id: 'security', label: 'Tenants & Redis', Icon: Shield },
  ];

  const tabTitles: Record<NavTab, string> = {
    projects: 'Onboarding Projects',
    templates: 'Project Templates',
    audit: 'Audit Trails',
    security: 'Tenants, RBAC & Redis Store',
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900">
          Workflow Engine
        </span>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
          className="lg:hidden p-1 text-slate-500 hover:text-slate-900"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tenant Selector */}
      <div className="p-4 border-b border-slate-200 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
            Client Organization
          </span>
          {session.role === 'CLIENT_USER' && (
            <span className="inline-flex items-center gap-1 text-slate-500">
              <Lock className="w-3 h-3" aria-hidden="true" />
              Locked
            </span>
          )}
        </div>
        <select
          aria-label="Active client organization"
          value={activeTenantId}
          disabled={accessibleTenants.length <= 1}
          onChange={(e) => handleSelectTenant(e.target.value)}
          className="w-full px-2.5 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:opacity-80 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {accessibleTenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="text-[11px] font-mono text-slate-500 truncate">
          {activeTenant?.id} · {activeTenant?.tier}
        </div>
      </div>

      {/* Primary Navigation */}
      <nav className="flex-1 p-3 space-y-1" aria-label="Primary workspace navigation">
        {navItems
          .filter((item) => !item.hidden)
          .map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <item.Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
      </nav>

      {/* Role Switcher & Session Profile */}
      <div className="p-4 border-t border-slate-200 space-y-3 bg-slate-50/60">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-900 truncate">{session.name}</div>
          <div className="text-xs text-blue-700 font-medium">
            {formatRoleLabel(session.role)}
          </div>
          <div className="text-[11px] text-slate-500 truncate">{session.email}</div>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-slate-200">
          <label
            htmlFor="quick-role-switch"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500"
          >
            <Users className="w-3 h-3" aria-hidden="true" />
            Switch Session Role
          </label>
          <select
            id="quick-role-switch"
            value={session.userId}
            onChange={(e) => handleQuickSwitchPersona(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800"
          >
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({formatRoleLabel(p.role)})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Revoke & Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full">{sidebarContent}</div>
          <div
            className="flex-1 bg-slate-900/35"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      {/* Main Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb left — Primary action right */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0 truncate">
              <span className="font-medium text-slate-900 truncate">
                {activeTenant?.name ?? activeTenantId}
              </span>
              <span aria-hidden="true">/</span>
              <span className="truncate">{tabTitles[activeTab]}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isManagerOrAdmin && (
              <button
                type="button"
                onClick={() => {
                  setLaunchTemplateId(undefined);
                  setCreateProjectOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New Project
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'projects' && (
            <ProjectWorkspace
              token={token}
              tenantId={activeTenantId}
              userRole={session.role}
              projects={projects}
              selectedProjectId={selectedProjectId}
              board={board}
              loadingBoard={loadingBoard}
              onSelectProject={handleSelectProject}
              onRefreshBoard={handleRefreshBoard}
              onOpenNewProject={() => {
                setLaunchTemplateId(undefined);
                setCreateProjectOpen(true);
              }}
            />
          )}

          {activeTab === 'templates' && session.role !== 'CLIENT_USER' && (
            <TemplatesView
              token={token}
              tenantId={activeTenantId}
              onLaunchTemplate={(tplId) => {
                setLaunchTemplateId(tplId);
                setCreateProjectOpen(true);
              }}
            />
          )}

          {activeTab === 'audit' && (
            <AuditTrailView
              token={token}
              tenantId={activeTenantId}
              userRole={session.role}
            />
          )}

          {activeTab === 'security' && (
            <TenantSecurityConsole
              token={token}
              tenantId={activeTenantId}
              session={session}
              allKnownTenants={allKnownTenants}
              onTenantCreated={() => {
                loadDirectory();
                api
                  .getMe(token, activeTenantId)
                  .then((me) => setAccessibleTenants(me.accessibleTenants))
                  .catch(() => {});
              }}
              onSessionInvalidated={handleSessionInvalidated}
            />
          )}
        </main>
      </div>

      <CreateProjectModal
        open={createProjectOpen}
        token={token}
        tenantId={activeTenantId}
        tenantName={activeTenant?.name ?? activeTenantId}
        initialTemplateId={launchTemplateId}
        onClose={() => setCreateProjectOpen(false)}
        onCreated={(createdBoard) => {
          setActiveTab('projects');
          loadTenantProjects(token, activeTenantId, createdBoard.project.id);
        }}
      />
    </div>
  );
}

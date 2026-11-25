import { useState } from 'react';
import { ArrowRight, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import type { SessionInfo, Tenant, UserAccount } from '../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { formatRoleLabel } from './StatusLabel.tsx';

interface AuthGateProps {
  personas: UserAccount[];
  tenants: Tenant[];
  loadingPersonas: boolean;
  directoryError: string | null;
  onRetryDirectory: () => void;
  onAuthenticated: (payload: {
    token: string;
    session: SessionInfo;
    accessibleTenants: Tenant[];
  }) => void;
}

export function AuthGate({
  personas,
  tenants,
  loadingPersonas,
  directoryError,
  onRetryDirectory,
  onAuthenticated,
}: AuthGateProps) {
  const [authMode, setAuthMode] = useState<'personas' | 'credentials'>('personas');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenantNameById = new Map(tenants.map((t) => [t.id, t.name]));

  async function handleSelectPersona(userId: string) {
    setError(null);
    setPendingUserId(userId);
    try {
      const result = await api.createWorkspaceSession(userId);
      onAuthenticated(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to start workspace session.');
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleCredentialLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.loginWithPassword(email, password);
      onAuthenticated(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between px-6 py-10">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between border-b border-slate-200 pb-5">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900">
          Workflow Engine
        </span>
        <span className="text-xs text-slate-500 font-mono">
          Multi-Tenant Customer Onboarding
        </span>
      </div>

      <main className="max-w-5xl w-full mx-auto my-auto py-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-5 space-y-5 pt-2">
          <p className="text-xs font-medium text-blue-700 tracking-wide">
            Tenant-Isolated Workspace Access
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 text-balance">
            Orchestrate every client launch with strict tenant boundaries.
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            Select a workspace role to issue a signed JWT tracked in the Redis session store, or
            sign in with an administrator-provisioned account.
          </p>

          <div className="pt-4 border-t border-slate-200 space-y-3 text-xs text-slate-600">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Repository queries enforce <span className="font-mono text-slate-900">tenant_id</span> scoping resolved from verified JWT claims and <span className="font-mono text-slate-900">X-Tenant-ID</span>.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                External client users are restricted to client-visible milestones within their own organization.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <KeyRound className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Bearer tokens remain in application memory only and are validated against active Redis keys on every request.
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4 mb-6">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Sign in to Workspace
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose a pre-configured role session or enter account credentials
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('personas');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  authMode === 'personas'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Role Sessions
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('credentials');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  authMode === 'credentials'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Email Login
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 px-3.5 py-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800"
            >
              {error}
            </div>
          )}

          {authMode === 'personas' ? (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
              {loadingPersonas ? (
                <div className="p-6 text-xs text-slate-500">Loading workspace accounts...</div>
              ) : directoryError ? (
                <div className="p-6 space-y-3 bg-rose-50/50">
                  <p className="text-xs text-rose-800">{directoryError}</p>
                  <button
                    type="button"
                    onClick={onRetryDirectory}
                    className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    Retry Connection
                  </button>
                </div>
              ) : (
                personas.map((user) => {
                  const isBusy = pendingUserId === user.id;
                  const orgName = tenantNameById.get(user.tenantId) ?? user.tenantId;
                  const scopeLabel =
                    user.role === 'INTERNAL_ADMIN'
                      ? 'All client tenants'
                      : user.allowedTenants
                          .map((id) => tenantNameById.get(id) ?? id)
                          .join(', ');

                  return (
                    <button
                      key={user.id}
                      type="button"
                      disabled={pendingUserId !== null}
                      onClick={() => handleSelectPersona(user.id)}
                      className="w-full text-left px-4 py-3.5 bg-white hover:bg-slate-50 transition-colors flex items-center justify-between gap-4 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                          <span className="truncate">{user.name}</span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="text-xs font-medium text-blue-700 whitespace-nowrap">
                            {formatRoleLabel(user.role)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                          <span>{user.email}</span>
                          <span aria-hidden="true">·</span>
                          <span>Primary: {orgName}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">Scope: {scopeLabel}</span>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
                        {isBusy ? 'Issuing JWT...' : 'Enter'}
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <form onSubmit={handleCredentialLogin} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Work Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
              <div>
                <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
              <div className="pt-2 flex items-center justify-between gap-4">
                <p className="text-xs text-slate-500">
                  Credentials are verified via server-side scrypt hashing.
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  {submitting ? 'Signing in...' : 'Sign In'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto border-t border-slate-200 pt-4 flex items-center justify-between text-xs text-slate-500">
        <span>Workflow Engine · Customer Onboarding Platform</span>
        <span>HS256 JWT + Redis Session Verification</span>
      </footer>
    </div>
  );
}

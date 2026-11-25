import { useEffect, useState } from 'react';
import {
  Database,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type {
  RedisTelemetry,
  SessionInfo,
  Tenant,
  UserAccount,
  UserRole,
} from '../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { formatRoleLabel } from './StatusLabel.tsx';

interface TenantSecurityConsoleProps {
  token: string;
  tenantId: string;
  session: SessionInfo;
  allKnownTenants: Tenant[];
  onTenantCreated: () => void;
  onSessionInvalidated: (message: string) => void;
}

export function TenantSecurityConsole({
  token,
  tenantId,
  session,
  allKnownTenants,
  onTenantCreated,
  onSessionInvalidated,
}: TenantSecurityConsoleProps) {
  const [telemetry, setTelemetry] = useState<RedisTelemetry | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Isolation Probe
  const [probeTenantId, setProbeTenantId] = useState(
    allKnownTenants.find((t) => t.id !== session.tenantId)?.id ?? session.tenantId
  );
  const [probeResult, setProbeResult] = useState<{
    status: number;
    ok: boolean;
    body: unknown;
    testedAt: string;
  } | null>(null);
  const [probing, setProbing] = useState(false);

  // New Tenant Form (Admin)
  const [showNewTenant, setShowNewTenant] = useState(false);
  const [tName, setTName] = useState('');
  const [tIndustry, setTIndustry] = useState('Enterprise SaaS');
  const [tTier, setTTier] = useState('Enterprise');
  const [tDomain, setTDomain] = useState('');

  // New User Form (Admin)
  const [showNewUser, setShowNewUser] = useState(false);
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uRole, setURole] = useState<UserRole>('CLIENT_USER');
  const [uTenant, setUTenant] = useState(tenantId);
  const [uPassword, setUPassword] = useState('');

  const isAdmin = session.role === 'INTERNAL_ADMIN';
  const canFlushCache = isAdmin || session.role === 'PROJECT_MANAGER';

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [telRes, usrRes, tenRes] = await Promise.all([
        api.getRedisTelemetry(token, tenantId),
        api.listUsers(token, tenantId),
        api.listTenants(token, tenantId),
      ]);
      setTelemetry(telRes.telemetry);
      setUsers(usrRes.users);
      setTenants(tenRes.tenants);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionInvalidated(err.message);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Unable to load security telemetry.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [token, tenantId]);

  async function handleRunProbe() {
    if (!probeTenantId) return;
    setProbing(true);
    try {
      const res = await api.probeTenantIsolation(token, probeTenantId);
      setProbeResult({
        ...res,
        testedAt: new Date().toLocaleTimeString('en-US', { hour12: false }),
      });
    } finally {
      setProbing(false);
    }
  }

  async function handleFlushCache() {
    setError(null);
    try {
      const res = await api.flushBoardCache(token, tenantId);
      setTelemetry(res.telemetry);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to flush board cache.');
    }
  }

  async function handleRevokeSession(jti: string) {
    setError(null);
    try {
      const res = await api.revokeSession(token, tenantId, jti);
      setTelemetry(res.telemetry);
      if (jti === session.jti) {
        onSessionInvalidated('Your active JWT session key was revoked from Redis.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to revoke session.');
    }
  }

  async function handleCreateTenant(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createTenant(token, tenantId, {
        name: tName,
        slug: tName,
        industry: tIndustry,
        tier: tTier,
        primaryDomain: tDomain || `${tName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
      });
      setTName('');
      setTDomain('');
      setShowNewTenant(false);
      onTenantCreated();
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to provision tenant.');
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createUser(token, tenantId, {
        name: uName,
        email: uEmail,
        role: uRole,
        tenantId: uTenant,
        password: uPassword || undefined,
      });
      setUName('');
      setUEmail('');
      setUPassword('');
      setShowNewUser(false);
      onTenantCreated();
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create user.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Tenants, RBAC & Redis Session Store
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Verify cross-tenant isolation boundaries, inspect active Redis session/board cache keys, and manage tenant access.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAll}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh State
        </button>
      </div>

      {error && (
        <div role="alert" className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Multi-Tenant Isolation Probe */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Live Cross-Tenant Isolation Probe
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Dispatch a real <span className="font-mono">GET /api/projects</span> request with your active JWT and an explicit <span className="font-mono">X-Tenant-ID</span> header.
            </p>
          </div>
          <div className="text-xs text-slate-600 font-mono">
            Active JWT Role: {session.role}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <select
            value={probeTenantId}
            onChange={(e) => setProbeTenantId(e.target.value)}
            aria-label="Target tenant ID for isolation probe"
            className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
          >
            {allKnownTenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.id})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={probing}
            onClick={handleRunProbe}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {probing ? 'Sending Request...' : 'Send Header Probe'}
          </button>
        </div>

        {probeResult && (
          <div
            className={`p-4 rounded-lg border text-xs space-y-2 ${
              probeResult.ok
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                : 'bg-rose-50/70 border-rose-200 text-rose-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2 font-medium">
              <span className="inline-flex items-center gap-1.5">
                {probeResult.ok ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-rose-700" />
                )}
                HTTP {probeResult.status} {probeResult.ok ? 'Authorized Tenant Read' : 'Blocked by Tenant Isolation Guard'}
              </span>
              <span className="font-mono tabular-nums opacity-75">{probeResult.testedAt}</span>
            </div>
            <pre className="font-mono text-[11px] bg-white/80 border border-black/10 rounded p-2.5 overflow-x-auto">
              {JSON.stringify(probeResult.body, null, 2)}
            </pre>
          </div>
        )}
      </section>

      {/* Redis Session & Cache Store */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-500" aria-hidden="true" />
              Redis Session & Board Cache Store
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tracks active JWT <span className="font-mono">jti</span> sessions and cached project boards with TTL eviction.
            </p>
          </div>
          {canFlushCache && (
            <button
              type="button"
              onClick={handleFlushCache}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
            >
              Flush Tenant Board Cache
            </button>
          )}
        </div>

        {telemetry && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200">
              <div className="p-4">
                <div className="text-xs text-slate-500">Active Sessions</div>
                <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                  {telemetry.activeSessions}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-slate-500">Cached Boards</div>
                <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                  {telemetry.cachedBoards}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-slate-500">Cache Hits / Misses</div>
                <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                  {telemetry.hits} / {telemetry.misses}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-slate-500">Hit Rate & Evictions</div>
                <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                  {telemetry.hitRatePercent}% · {telemetry.invalidations} inv
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-2.5 pl-6 pr-3">Redis Key</th>
                    <th className="py-2.5 px-3">Namespace</th>
                    <th className="py-2.5 px-3">Tenant</th>
                    <th className="py-2.5 px-3">Value Summary</th>
                    <th className="py-2.5 px-3 text-right">TTL</th>
                    <th className="py-2.5 pl-3 pr-6 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {telemetry.entries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">
                        No active keys in scope.
                      </td>
                    </tr>
                  ) : (
                    telemetry.entries.map((entry) => {
                      const isSession = entry.namespace === 'session';
                      const jti = isSession ? entry.key.replace('session:jwt:', '') : null;
                      const isCurrentSession = jti === session.jti;

                      return (
                        <tr key={entry.key} className="hover:bg-slate-50">
                          <td className="py-2.5 pl-6 pr-3 font-mono text-slate-800 max-w-xs truncate">
                            {entry.key}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600">
                            {entry.namespace}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600">
                            {entry.tenantId ?? '—'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            {entry.preview}
                            {isCurrentSession && ' (Current)'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {entry.ttlRemainingSeconds}s
                          </td>
                          <td className="py-2.5 pl-3 pr-6 text-right whitespace-nowrap">
                            {isSession && isAdmin && jti ? (
                              <button
                                type="button"
                                onClick={() => handleRevokeSession(jti)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:underline"
                              >
                                <Trash2 className="w-3 h-3" />
                                Revoke
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Tenants & Users Directory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Accessible Client Tenants ({tenants.length})
            </h3>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowNewTenant((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="w-3.5 h-3.5" />
                Provision Tenant
              </button>
            )}
          </div>

          {showNewTenant && isAdmin && (
            <form
              onSubmit={handleCreateTenant}
              className="p-4 bg-slate-50 border-b border-slate-200 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  required
                  value={tName}
                  onChange={(e) => setTName(e.target.value)}
                  placeholder="Organization name (e.g., Meridian Cloud)"
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                />
                <input
                  type="text"
                  value={tDomain}
                  onChange={(e) => setTDomain(e.target.value)}
                  placeholder="Domain (e.g., meridiancloud.io)"
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                />
                <input
                  type="text"
                  value={tIndustry}
                  onChange={(e) => setTIndustry(e.target.value)}
                  placeholder="Industry"
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                />
                <select
                  value={tTier}
                  onChange={(e) => setTTier(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                >
                  <option value="Enterprise">Enterprise</option>
                  <option value="Enterprise Plus">Enterprise Plus</option>
                  <option value="Growth">Growth</option>
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewTenant(false)}
                  className="px-3 py-1 text-xs text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-md"
                >
                  Create Tenant
                </button>
              </div>
            </form>
          )}

          <div className="divide-y divide-slate-200">
            {tenants.map((t) => (
              <div key={t.id} className="px-5 py-3.5 text-xs flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-slate-900">{t.name}</div>
                  <div className="text-slate-500 mt-0.5">
                    {t.industry} · {t.tier} · {t.primaryDomain}
                  </div>
                </div>
                <span className="font-mono text-slate-500 shrink-0">{t.id}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Scoped RBAC Users ({users.length})
            </h3>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowNewUser((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add User
              </button>
            )}
          </div>

          {showNewUser && isAdmin && (
            <form
              onSubmit={handleCreateUser}
              className="p-4 bg-slate-50 border-b border-slate-200 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  required
                  value={uName}
                  onChange={(e) => setUName(e.target.value)}
                  placeholder="Full name"
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                />
                <input
                  type="email"
                  required
                  value={uEmail}
                  onChange={(e) => setUEmail(e.target.value)}
                  placeholder="Work email"
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                />
                <select
                  value={uRole}
                  onChange={(e) => setURole(e.target.value as UserRole)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                >
                  <option value="CLIENT_USER">Client User</option>
                  <option value="PROJECT_MANAGER">Project Manager</option>
                  <option value="INTERNAL_ADMIN">Internal Admin</option>
                </select>
                <select
                  value={uTenant}
                  onChange={(e) => setUTenant(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                >
                  {allKnownTenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <input
                  type="password"
                  minLength={6}
                  value={uPassword}
                  onChange={(e) => setUPassword(e.target.value)}
                  placeholder="Optional password (min 6 chars, scrypt hashed)"
                  className="sm:col-span-2 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewUser(false)}
                  className="px-3 py-1 text-xs text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-md"
                >
                  Create User
                </button>
              </div>
            </form>
          )}

          <div className="divide-y divide-slate-200">
            {users.map((u) => (
              <div key={u.id} className="px-5 py-3.5 text-xs flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {u.name} · <span className="text-blue-700">{formatRoleLabel(u.role)}</span>
                  </div>
                  <div className="text-slate-500 mt-0.5 truncate">
                    {u.email} · {u.title}
                  </div>
                </div>
                <span className="font-mono text-slate-500 shrink-0">{u.tenantId}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

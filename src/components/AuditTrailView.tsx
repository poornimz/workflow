import { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { AuditEventType, AuditLogEntry, UserRole } from '../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { formatRoleLabel, formatTimestamp } from './StatusLabel.tsx';

interface AuditTrailViewProps {
  token: string;
  tenantId: string;
  userRole: UserRole;
}

const EVENT_TYPES: Array<'ALL' | AuditEventType> = [
  'ALL',
  'STATUS_TRANSITION',
  'DEPENDENCY_ADDED',
  'DEPENDENCY_REMOVED',
  'PROJECT_CREATED',
  'TASK_CREATED',
  'TASK_UPDATED',
  'ACCESS_DENIED',
  'SESSION_ISSUED',
  'SESSION_REVOKED',
  'CACHE_INVALIDATED',
];

export function AuditTrailView({ token, tenantId, userRole }: AuditTrailViewProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<'ALL' | AuditEventType>('ALL');
  const [scopeAll, setScopeAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  async function loadLogs() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listAuditLogs(token, tenantId, {
        scopeAll: userRole === 'INTERNAL_ADMIN' && scopeAll,
        eventType: eventFilter,
      });
      setLogs(res.logs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to fetch audit trail.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, [token, tenantId, eventFilter, scopeAll]);

  const filtered = logs.filter((l) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      l.entityLabel.toLowerCase().includes(q) ||
      l.details.toLowerCase().includes(q) ||
      l.actorName.toLowerCase().includes(q) ||
      (l.tenantName ?? l.tenantId).toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Immutable Audit Trails
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every workflow status transition, dependency mutation, cache eviction, and blocked tenant boundary probe.
          </p>
        </div>

        <button
          type="button"
          onClick={loadLogs}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Ledger
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search actor, task, or details..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg w-64"
            />
          </div>

          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value as 'ALL' | AuditEventType)}
            aria-label="Filter by audit event type"
            className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-700"
          >
            {EVENT_TYPES.map((ev) => (
              <option key={ev} value={ev}>
                {ev === 'ALL' ? 'All Event Types' : ev}
              </option>
            ))}
          </select>
        </div>

        {userRole === 'INTERNAL_ADMIN' && (
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={scopeAll}
              onChange={(e) => setScopeAll(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            Global cross-tenant ledger (Admin)
          </label>
        )}
      </div>

      {error && (
        <div role="alert" className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 pl-5 pr-3 whitespace-nowrap">Timestamp</th>
                <th className="py-3 px-3 whitespace-nowrap">Actor & Role</th>
                <th className="py-3 px-3 whitespace-nowrap">Tenant</th>
                <th className="py-3 px-3 whitespace-nowrap">Event</th>
                <th className="py-3 px-3">Entity & Transition</th>
                <th className="py-3 pl-3 pr-5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading audit entries...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No audit records found for this scope.
                  </td>
                </tr>
              ) : (
                filtered.map((log) => {
                  const isDenied = log.eventType === 'ACCESS_DENIED';
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/80 align-top">
                      <td className="py-3 pl-5 pr-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-medium text-slate-900">{log.actorName}</div>
                        <div className="text-slate-500">{formatRoleLabel(log.actorRole)}</div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-slate-700">
                        {log.tenantName ?? log.tenantId}
                      </td>
                      <td
                        className={`py-3 px-3 font-mono whitespace-nowrap font-medium ${
                          isDenied ? 'text-rose-700' : 'text-slate-800'
                        }`}
                      >
                        {log.eventType}
                      </td>
                      <td className="py-3 px-3 min-w-[200px]">
                        <div className="font-medium text-slate-900">{log.entityLabel}</div>
                        {log.fromStatus && log.toStatus && (
                          <div className="mt-0.5 font-mono text-blue-700">
                            {log.fromStatus} → {log.toStatus}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pl-3 pr-5 text-slate-600 max-w-sm leading-relaxed">
                        {log.details}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

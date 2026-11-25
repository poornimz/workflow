import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Eye,
  Lock,
  ShieldAlert,
} from 'lucide-react';
import type { ProjectHealth, TaskStatus, UserRole } from '../../shared/types.ts';

export const STATUS_META: Record<
  TaskStatus,
  { label: string; textColor: string; Icon: typeof CheckCircle2 }
> = {
  NOT_STARTED: {
    label: 'Not Started',
    textColor: 'text-slate-600',
    Icon: CircleDashed,
  },
  IN_PROGRESS: {
    label: 'In Progress',
    textColor: 'text-blue-700',
    Icon: Clock,
  },
  IN_REVIEW: {
    label: 'In Review',
    textColor: 'text-amber-700',
    Icon: Eye,
  },
  BLOCKED: {
    label: 'Blocked',
    textColor: 'text-rose-700',
    Icon: ShieldAlert,
  },
  COMPLETED: {
    label: 'Completed',
    textColor: 'text-emerald-700',
    Icon: CheckCircle2,
  },
};

export function TaskStatusInline({
  status,
  isGated,
}: {
  status: TaskStatus;
  isGated?: boolean;
}) {
  const meta = STATUS_META[status];
  const Icon = isGated && status === 'NOT_STARTED' ? Lock : meta.Icon;
  const color = isGated && status === 'NOT_STARTED' ? 'text-amber-700' : meta.textColor;
  const label = isGated && status === 'NOT_STARTED' ? 'Dependency Gated' : meta.label;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${color}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function HealthInline({ health }: { health: ProjectHealth }) {
  if (health === 'ON_TRACK') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>On Track</span>
      </span>
    );
  }
  if (health === 'AT_RISK') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>At Risk</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap">
      <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>Delayed</span>
    </span>
  );
}

export function formatRoleLabel(role: UserRole | 'SYSTEM'): string {
  switch (role) {
    case 'INTERNAL_ADMIN':
      return 'Internal Admin';
    case 'PROJECT_MANAGER':
      return 'Project Manager';
    case 'CLIENT_USER':
      return 'Client User';
    default:
      return 'System';
  }
}

export function formatShortDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTimestamp(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

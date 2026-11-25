import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ProjectBoardResponse, ProjectTemplate } from '../../shared/types.ts';
import { api, ApiError } from '../api.ts';

interface CreateProjectModalProps {
  open: boolean;
  token: string;
  tenantId: string;
  tenantName: string;
  initialTemplateId?: string;
  onClose: () => void;
  onCreated: (board: ProjectBoardResponse) => void;
}

export function CreateProjectModal({
  open,
  token,
  tenantId,
  tenantName,
  initialTemplateId,
  onClose,
  onCreated,
}: CreateProjectModalProps) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [templateId, setTemplateId] = useState(initialTemplateId ?? '');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoadingTemplates(true);
    api
      .listTemplates(token, tenantId)
      .then((res) => {
        setTemplates(res.templates);
        if (initialTemplateId && res.templates.some((t) => t.id === initialTemplateId)) {
          setTemplateId(initialTemplateId);
        } else if (res.templates.length > 0 && !templateId) {
          setTemplateId(res.templates[0].id);
        }
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load templates.');
      })
      .finally(() => setLoadingTemplates(false));
  }, [open, token, tenantId, initialTemplateId]);

  if (!open) return null;

  const selectedTemplate = templates.find((t) => t.id === templateId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const board = await api.createProject(token, tenantId, {
        templateId,
        name,
        startDate,
      });
      setName('');
      onCreated(board);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create project.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-project-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="create-project-title" className="font-display text-base font-semibold text-slate-900">
              Launch Onboarding Project
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tenant scope: {tenantName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="prj-name" className="block text-xs font-medium text-slate-700 mb-1.5">
              Project Name
            </label>
            <input
              id="prj-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${tenantName} Production Rollout`}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label htmlFor="prj-template" className="block text-xs font-medium text-slate-700 mb-1.5">
              Blueprint Template
            </label>
            <select
              id="prj-template"
              value={templateId}
              disabled={loadingTemplates}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.tasks.length} tasks · {tpl.estimatedDays}d)
                </option>
              ))}
            </select>
            {selectedTemplate && (
              <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                {selectedTemplate.description}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="prj-start" className="block text-xs font-medium text-slate-700 mb-1.5">
              Kickoff Start Date
            </label>
            <input
              id="prj-start"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !templateId}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {submitting ? 'Creating Project...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

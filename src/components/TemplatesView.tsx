import { useEffect, useState } from 'react';
import { GitBranch, Play, Plus, Trash2 } from 'lucide-react';
import type { ProjectTemplate, TaskOwnerType } from '../../shared/types.ts';
import { api, ApiError } from '../api.ts';

interface TemplatesViewProps {
  token: string;
  tenantId: string;
  onLaunchTemplate: (templateId: string) => void;
}

interface DraftTask {
  phase: string;
  title: string;
  description: string;
  ownerType: TaskOwnerType;
  clientVisible: boolean;
  dayOffset: number;
  dependsOnOrders: number[];
}

export function TemplatesView({
  token,
  tenantId,
  onLaunchTemplate,
}: TemplatesViewProps) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState('Enterprise SaaS');
  const [tplDays, setTplDays] = useState(30);
  const [tplDesc, setTplDesc] = useState('');
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([
    {
      phase: 'Phase 1 · Discovery',
      title: 'Confirm implementation stakeholders',
      description: 'Identify technical and business sign-off leads.',
      ownerType: 'CLIENT',
      clientVisible: true,
      dayOffset: 2,
      dependsOnOrders: [],
    },
    {
      phase: 'Phase 2 · Configuration',
      title: 'Provision SSO & tenant workspace',
      description: 'Configure SAML metadata and test login flow.',
      ownerType: 'INTERNAL',
      clientVisible: true,
      dayOffset: 7,
      dependsOnOrders: [1],
    },
  ]);
  const [saving, setSaving] = useState(false);

  async function loadTemplates() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listTemplates(token, tenantId);
      setTemplates(res.templates);
      if (res.templates.length > 0 && !selectedId) {
        setSelectedId(res.templates[0].id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load templates.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTemplates();
  }, [token, tenantId]);

  const activeTemplate = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await api.createTemplate(token, tenantId, {
        name: tplName,
        category: tplCategory,
        description: tplDesc || 'Standardized multi-phase onboarding playbook.',
        estimatedDays: tplDays,
        tasks: draftTasks,
      });
      setTemplates((prev) => [res.template, ...prev]);
      setSelectedId(res.template.id);
      setTplName('');
      setTplDesc('');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create template.');
    } finally {
      setSaving(false);
    }
  }

  function addDraftRow() {
    const nextOrder = draftTasks.length + 1;
    setDraftTasks((prev) => [
      ...prev,
      {
        phase: 'Phase 2 · Configuration',
        title: '',
        description: 'Deliverable milestone.',
        ownerType: 'INTERNAL',
        clientVisible: true,
        dayOffset: nextOrder * 4,
        dependsOnOrders: nextOrder > 1 ? [nextOrder - 1] : [],
      },
    ]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Onboarding Project Templates
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Standardized blueprints with pre-wired task phases, client visibility defaults, and dependency chains.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          New Template
        </button>
      </div>

      {error && (
        <div role="alert" className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
          {error}
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleSaveTemplate}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Author Project Blueprint
            </h3>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Template Name
              </label>
              <input
                type="text"
                required
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="Enterprise API Cutover"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Category
              </label>
              <input
                type="text"
                value={tplCategory}
                onChange={(e) => setTplCategory(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Target Duration (Days)
              </label>
              <input
                type="number"
                min={1}
                value={tplDays}
                onChange={(e) => setTplDays(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Blueprint Description
            </label>
            <input
              type="text"
              value={tplDesc}
              onChange={(e) => setTplDesc(e.target.value)}
              placeholder="Outline phases and target customer segment..."
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">
                Template Tasks ({draftTasks.length})
              </span>
              <button
                type="button"
                onClick={addDraftRow}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                + Add Step
              </button>
            </div>
            <div className="space-y-2">
              {draftTasks.map((dt, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                >
                  <span className="md:col-span-1 font-mono text-slate-500">#{idx + 1}</span>
                  <input
                    type="text"
                    required
                    value={dt.title}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraftTasks((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, title: val } : item))
                      );
                    }}
                    placeholder="Task title"
                    className="md:col-span-4 px-2.5 py-1.5 bg-white border border-slate-300 rounded-md"
                  />
                  <input
                    type="text"
                    value={dt.phase}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraftTasks((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, phase: val } : item))
                      );
                    }}
                    placeholder="Phase"
                    className="md:col-span-3 px-2.5 py-1.5 bg-white border border-slate-300 rounded-md"
                  />
                  <select
                    value={dt.ownerType}
                    onChange={(e) => {
                      const val = e.target.value as TaskOwnerType;
                      setDraftTasks((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, ownerType: val } : item))
                      );
                    }}
                    className="md:col-span-2 px-2 py-1.5 bg-white border border-slate-300 rounded-md"
                  >
                    <option value="CLIENT">Client</option>
                    <option value="INTERNAL">Internal</option>
                  </select>
                  <div className="md:col-span-2 flex items-center justify-end gap-2">
                    <label className="inline-flex items-center gap-1 text-slate-600">
                      <input
                        type="checkbox"
                        checked={dt.clientVisible}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setDraftTasks((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, clientVisible: checked } : item
                            )
                          );
                        }}
                      />
                      Visible
                    </label>
                    {draftTasks.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDraftTasks((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label="Remove task step"
                        className="p-1 text-slate-400 hover:text-rose-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              {saving ? 'Publishing...' : 'Publish Template'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-xs text-slate-500">
          Loading templates...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 space-y-3">
            {templates.map((tpl) => {
              const active = tpl.id === activeTemplate?.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedId(tpl.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    active
                      ? 'bg-white border-blue-600 ring-1 ring-blue-600'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs text-slate-500">
                    {tpl.category} · {tpl.estimatedDays} days · {tpl.tasks.length} tasks
                  </div>
                  <div className="mt-1 font-display text-sm font-semibold text-slate-900">
                    {tpl.name}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 line-clamp-2">
                    {tpl.description}
                  </p>
                </button>
              );
            })}
          </div>

          {activeTemplate && (
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-500">
                    {activeTemplate.category} · Created by {activeTemplate.createdBy} ·{' '}
                    <span className="font-mono tabular-nums">{activeTemplate.estimatedDays}d</span>{' '}
                    playbook
                  </div>
                  <h3 className="font-display text-base font-semibold text-slate-900 mt-0.5">
                    {activeTemplate.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onLaunchTemplate(activeTemplate.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  Launch Project
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 pl-6 pr-3">#</th>
                      <th className="py-2.5 px-3">Milestone & Phase</th>
                      <th className="py-2.5 px-3">Owner</th>
                      <th className="py-2.5 px-3">Visibility</th>
                      <th className="py-2.5 px-3">Dependencies</th>
                      <th className="py-2.5 pl-3 pr-6 text-right">Offset</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {activeTemplate.tasks.map((tt) => (
                      <tr key={tt.id} className="hover:bg-slate-50">
                        <td className="py-3 pl-6 pr-3 font-mono tabular-nums text-slate-500">
                          {tt.sortOrder}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900">{tt.title}</div>
                          <div className="text-slate-500 mt-0.5">{tt.phase}</div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-700">
                          {tt.ownerType === 'CLIENT' ? 'Client' : 'Internal'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-600">
                          {tt.clientVisible ? 'Client Portal' : 'Internal Only'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-600 font-mono">
                          {tt.dependsOnOrders.length === 0 ? (
                            '—'
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <GitBranch className="w-3 h-3 text-slate-400" />
                              Step {tt.dependsOnOrders.join(', ')}
                            </span>
                          )}
                        </td>
                        <td className="py-3 pl-3 pr-6 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          Day {tt.dayOffset}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Plus, Trash2, Archive, RotateCcw, Pencil, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useProjects } from '../../hooks/useProjects';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { formatBRL } from '../../lib/utils';
import type { Project, Transaction } from '../../types';

const PROJECT_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export function ProjectsPage() {
  const { projects, loading, addProject, updateProject, deleteProject } = useProjects();
  const { transactions } = useTransactions();
  const { categories } = useCategories();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [showArchived, setShowArchived] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await addProject({ name: name.trim(), color, status: 'active' });
    setName('');
    setColor(PROJECT_COLORS[0]);
    setShowForm(false);
  }

  function getProjectTotals(projectId: string) {
    const txs = transactions.filter((t) => t.projectId === projectId);
    const income = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    return { count: txs.length, income, expense, balance: income + expense };
  }

  function getProjectTransactions(projectId: string) {
    return transactions
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status === 'archived');

  if (loading) {
    return <div className="text-accent text-sm animate-pulse">Carregando projetos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-text-primary">Projetos</h2>
        <div className="flex gap-2">
          {archived.length > 0 && (
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border text-text-secondary text-xs rounded hover:border-accent"
            >
              <Archive size={14} /> {showArchived ? 'Ocultar encerrados' : `Encerrados (${archived.length})`}
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90"
          >
            <Plus size={14} /> Novo Projeto
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-bg-card border border-accent/30 rounded-lg p-4 space-y-3">
          <p className="text-xs font-bold text-text-primary">Novo projeto</p>
          <div>
            <label className="text-xs text-text-secondary block mb-1">Nome</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Reforma cozinha, Viagem Europa..."
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">Cor</label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90">Criar</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 bg-bg-secondary border border-border text-text-secondary text-xs rounded">Cancelar</button>
          </div>
        </form>
      )}

      {active.length === 0 && !showForm ? (
        <div className="bg-bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-sm text-text-secondary">Nenhum projeto em andamento.</p>
          <p className="text-xs text-text-secondary mt-1">Crie projetos para agrupar despesas e receitas (ex: reforma, viagem, evento).</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {active.map((p) => (
            <ProjectCard key={p.id} project={p} totals={getProjectTotals(p.id)} projectTransactions={getProjectTransactions(p.id)} categories={categories} onUpdate={updateProject} onDelete={deleteProject} />
          ))}
        </div>
      )}

      {showArchived && archived.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">Encerrados</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {archived.map((p) => (
              <ProjectCard key={p.id} project={p} totals={getProjectTotals(p.id)} projectTransactions={getProjectTransactions(p.id)} categories={categories} onUpdate={updateProject} onDelete={deleteProject} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, totals, projectTransactions, categories, onUpdate, onDelete }: {
  project: Project;
  totals: { count: number; income: number; expense: number; balance: number };
  projectTransactions: Transaction[];
  categories: import('../../types').Category[];
  onUpdate: (id: string, data: Partial<Project>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const isArchived = project.status === 'archived';
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editColor, setEditColor] = useState(project.color);
  const [showTxs, setShowTxs] = useState(false);

  async function saveEdit() {
    if (!editName.trim()) return;
    await onUpdate(project.id, { name: editName.trim(), color: editColor });
    setEditing(false);
  }

  function cancelEdit() {
    setEditName(project.name);
    setEditColor(project.color);
    setEditing(false);
  }

  function getCategoryName(id: string | null) {
    if (!id) return '—';
    return categories.find((c) => c.id === id)?.name ?? '—';
  }

  return (
    <div className={`bg-bg-card border rounded-lg overflow-hidden ${isArchived ? 'border-border/40 opacity-70' : 'border-border'}`}>
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          {editing ? (
            <div className="flex-1 space-y-2">
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                className="w-full bg-bg-secondary border border-accent rounded px-2 py-1 text-xs text-text-primary focus:outline-none"
              />
              <div className="flex gap-1.5">
                {PROJECT_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setEditColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${editColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
              <span className="text-sm font-bold text-text-primary truncate">{project.name}</span>
            </div>
          )}

          <div className="flex items-center gap-1 flex-shrink-0">
            {editing ? (
              <>
                <button onClick={saveEdit} className="p-1 text-accent-green hover:text-accent-green/80" title="Salvar"><Check size={13} /></button>
                <button onClick={cancelEdit} className="p-1 text-text-secondary hover:text-accent-red" title="Cancelar"><X size={13} /></button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)} className="p-1 text-text-secondary hover:text-accent" title="Editar"><Pencil size={12} /></button>
                {totals.count === 0 && (
                  <button onClick={() => onDelete(project.id)} className="p-1 text-text-secondary hover:text-accent-red" title="Excluir">
                    <Trash2 size={12} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
            isArchived
              ? 'bg-text-secondary/10 text-text-secondary'
              : 'bg-accent-green/10 text-accent-green'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isArchived ? 'bg-text-secondary' : 'bg-accent-green'}`} />
            {isArchived ? 'Encerrado' : 'Em andamento'}
          </span>
          <span className="text-[10px] text-text-secondary">{totals.count} transações</span>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/40">
          <div>
            <span className="text-text-secondary text-[10px]">Receitas</span>
            <p className="text-accent-green font-bold">{formatBRL(totals.income)}</p>
          </div>
          <div>
            <span className="text-text-secondary text-[10px]">Despesas</span>
            <p className="text-accent-red font-bold">{formatBRL(totals.expense)}</p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-0.5">
          <span className={`text-xs font-bold ${totals.balance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            Saldo: {formatBRL(totals.balance)}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1 border-t border-border/40">
          <button
            onClick={() => onUpdate(project.id, { status: isArchived ? 'active' : 'archived' })}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors flex-1 justify-center ${
              isArchived
                ? 'border-accent-green/40 text-accent-green hover:bg-accent-green/10'
                : 'border-border text-text-secondary hover:border-accent-red/60 hover:text-accent-red'
            }`}
          >
            {isArchived ? <><RotateCcw size={12} /> Reativar</> : <><Archive size={12} /> Encerrar projeto</>}
          </button>
          {totals.count > 0 && (
            <button
              onClick={() => setShowTxs(!showTxs)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-border text-text-secondary hover:border-accent hover:text-accent transition-colors"
            >
              {showTxs ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Ver lançamentos
            </button>
          )}
        </div>
      </div>

      {/* Transaction list */}
      {showTxs && (
        <div className="border-t border-border/40 bg-bg-secondary/40">
          <div className="max-h-64 overflow-y-auto">
            {projectTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-2 border-b border-border/20 last:border-0 gap-2">
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs text-text-primary truncate">{tx.description}</span>
                  <span className="text-[10px] text-text-secondary">
                    {tx.date.toLocaleDateString('pt-BR')} · {getCategoryName(tx.categoryId)}
                  </span>
                </div>
                <span className={`text-xs font-bold flex-shrink-0 ${tx.amount >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatBRL(tx.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

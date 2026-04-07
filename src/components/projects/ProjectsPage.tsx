import { useState } from 'react';
import { Plus, Trash2, Archive, RotateCcw } from 'lucide-react';
import { useProjects } from '../../hooks/useProjects';
import { useTransactions } from '../../hooks/useTransactions';
import { formatBRL } from '../../lib/utils';
import type { Project } from '../../types';

const PROJECT_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export function ProjectsPage() {
  const { projects, loading, addProject, updateProject, deleteProject } = useProjects();
  const { transactions } = useTransactions();
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
              <Archive size={14} /> {showArchived ? 'Ocultar arquivados' : `Arquivados (${archived.length})`}
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
        <form onSubmit={handleSubmit} className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
          <div>
            <label className="text-xs text-text-secondary block mb-1">Nome do projeto</label>
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
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90">
              Criar
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 bg-bg-secondary border border-border text-text-secondary text-xs rounded">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {active.length === 0 && !showForm ? (
        <div className="bg-bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-sm text-text-secondary">Nenhum projeto ativo.</p>
          <p className="text-xs text-text-secondary mt-1">Crie projetos para agrupar despesas e receitas (ex: reforma, viagem, evento).</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {active.map((p) => <ProjectCard key={p.id} project={p} totals={getProjectTotals(p.id)} onUpdate={updateProject} onDelete={deleteProject} />)}
        </div>
      )}

      {showArchived && archived.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-text-secondary uppercase">Arquivados</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {archived.map((p) => <ProjectCard key={p.id} project={p} totals={getProjectTotals(p.id)} onUpdate={updateProject} onDelete={deleteProject} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, totals, onUpdate, onDelete }: {
  project: Project;
  totals: { count: number; income: number; expense: number; balance: number };
  onUpdate: (id: string, data: Partial<Project>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const isArchived = project.status === 'archived';

  return (
    <div className={`bg-bg-card border rounded-lg p-4 space-y-3 ${isArchived ? 'border-border/50 opacity-60' : 'border-border'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }} />
          <span className="text-sm font-bold text-text-primary">{project.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onUpdate(project.id, { status: isArchived ? 'active' : 'archived' })}
            className="p-1 text-text-secondary hover:text-accent"
            title={isArchived ? 'Reativar' : 'Arquivar'}
          >
            {isArchived ? <RotateCcw size={12} /> : <Archive size={12} />}
          </button>
          {totals.count === 0 && (
            <button onClick={() => onDelete(project.id)} className="p-1 text-text-secondary hover:text-accent-red" title="Excluir">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-text-secondary">Receitas</span>
          <p className="text-accent-green font-bold">{formatBRL(totals.income)}</p>
        </div>
        <div>
          <span className="text-text-secondary">Despesas</span>
          <p className="text-accent-red font-bold">{formatBRL(totals.expense)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{totals.count} transacoes</span>
        <span className={`font-bold ${totals.balance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
          Saldo: {formatBRL(totals.balance)}
        </span>
      </div>
    </div>
  );
}

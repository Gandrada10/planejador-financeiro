import { useMemo, useState } from 'react';
import { Plus, Trash2, Archive, RotateCcw, Pencil, Check, X } from 'lucide-react';
import { useProjects } from '../../hooks/useProjects';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useAccounts } from '../../hooks/useAccounts';
import { useTitularMappings } from '../../hooks/useTitularMappings';
import { useFamilyMembers } from '../../hooks/useFamilyMembers';
import { formatBRL0, formatFx } from '../../lib/utils';
import { computeProjectStats, groupByProject, type ProjectStats } from '../../lib/projectStats';
import { toggleCategoryRule } from '../../lib/categoryRules';
import { BudgetRuler } from '../shared/BudgetRuler';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { ProjectDetail } from './ProjectDetail';
import type { Project, Transaction } from '../../types';

const PROJECT_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

/**
 * Orçamento digitado → número. Convenção pt-BR: ponto é milhar, vírgula é
 * decimal ("120.000,50"). Vazio ou não-positivo vira null = sem orçamento.
 */
function parseBudget(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Aba Projetos — lista à esquerda, projeto aberto à direita.
 *
 * A versão anterior era uma grade de cards em que cada card carregava um
 * resumo e uma lista de lançamentos SOMENTE-LEITURA de altura fixa. Dava
 * para ver que o dinheiro tinha ido embora, não para trabalhar em cima
 * disso: nenhum campo era editável e não havia como filtrar, buscar ou
 * exportar. Com um card ocupando um terço da tela, também não havia largura
 * para a tabela de lançamentos de verdade.
 *
 * O formato lista+detalhe resolve as duas coisas: a lista fica estreita
 * (nome, gasto, régua — o que basta para comparar projetos de relance) e
 * devolve a tela inteira ao projeto aberto, que é onde mora a tabela
 * completa e editável.
 */
export function ProjectsPage() {
  const { projects, loading, addProject, updateProject, deleteProject } = useProjects();
  const { transactions, updateTransaction, deleteTransaction, batchUpdate, batchUpdateReconciled } = useTransactions();
  const { categories, rules, addRule, deleteRule } = useCategories();
  const { accountNames } = useAccounts();
  const { titularNames } = useTitularMappings();
  const { memberNames } = useFamilyMembers();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  // Um passe só na base, e não um filtro por projeto: com uma dezena de
  // projetos e centenas de lançamentos, filtrar por projeto varreria a lista
  // inteira uma vez para cada um.
  const byProject = useMemo(() => groupByProject(transactions), [transactions]);
  const statsById = useMemo(() => {
    const map = new Map<string, ProjectStats>();
    for (const p of projects) {
      map.set(p.id, computeProjectStats(byProject.get(p.id) ?? [], categories));
    }
    return map;
  }, [projects, byProject, categories]);

  const active = useMemo(
    () => projects.filter((p) => p.status === 'active')
      .sort((a, b) => Math.abs(statsById.get(b.id)?.expense ?? 0) - Math.abs(statsById.get(a.id)?.expense ?? 0)),
    [projects, statsById]
  );
  const archived = useMemo(
    () => projects.filter((p) => p.status === 'archived')
      .sort((a, b) => Math.abs(statsById.get(b.id)?.expense ?? 0) - Math.abs(statsById.get(a.id)?.expense ?? 0)),
    [projects, statsById]
  );

  // Seleção DERIVADA, não sincronizada por efeito: o estado guarda só a
  // escolha explícita do usuário, e o render cai no primeiro da lista quando
  // ela não existe ou saiu de vista (projeto encerrado com "encerrados"
  // ocultos, projeto excluído). Um efeito que chamasse setState aqui
  // dispararia render em cascata e deixaria um quadro com o painel vazio.
  const visibleList = showArchived ? [...active, ...archived] : active;
  const effectiveId = selectedId && visibleList.some((p) => p.id === selectedId)
    ? selectedId
    : visibleList[0]?.id ?? null;

  const selected = projects.find((p) => p.id === effectiveId) ?? null;
  const selectedStats = selected ? statsById.get(selected.id) ?? null : null;

  const memberOptions = memberNames.length > 0 ? memberNames : titularNames;

  function handleCreateRule(description: string, categoryId: string) {
    return toggleCategoryRule({ rules, addRule, deleteRule }, description, categoryId);
  }

  if (loading) {
    return <div className="text-accent text-body animate-pulse">Carregando projetos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-text-primary">Projetos</h2>
        <div className="flex gap-2">
          {archived.length > 0 && (
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border text-text-secondary text-body rounded-control hover:border-accent"
            >
              <Archive size={14} /> {showArchived ? 'Ocultar encerrados' : `Encerrados (${archived.length})`}
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg-primary text-body font-bold rounded-control hover:opacity-90"
          >
            <Plus size={14} /> Novo Projeto
          </button>
        </div>
      </div>

      {showForm && (
        <ProjectForm
          onCancel={() => setShowForm(false)}
          onSubmit={async (data) => { await addProject(data); setShowForm(false); }}
        />
      )}

      {projects.length === 0 && !showForm ? (
        <div className="bg-bg-card border border-border rounded-card p-8 text-center">
          <p className="text-body text-text-secondary">Nenhum projeto ainda.</p>
          <p className="text-caption text-text-secondary mt-1">
            Crie projetos para agrupar despesas e receitas (ex: reforma, viagem, evento).
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,280px)_1fr] gap-4 items-start">
          {/* Lista */}
          <div className="space-y-1.5">
            {active.map((p) => (
              <ProjectListItem
                key={p.id}
                project={p}
                stats={statsById.get(p.id)}
                selected={p.id === effectiveId}
                onSelect={() => setSelectedId(p.id)}
              />
            ))}
            {showArchived && archived.length > 0 && (
              <>
                <p className="text-caption text-ink-3 uppercase tracking-wider pt-3 pb-1">Encerrados</p>
                {archived.map((p) => (
                  <ProjectListItem
                    key={p.id}
                    project={p}
                    stats={statsById.get(p.id)}
                    selected={p.id === effectiveId}
                    onSelect={() => setSelectedId(p.id)}
                  />
                ))}
              </>
            )}
          </div>

          {/* Detalhe */}
          {selected && selectedStats ? (
            <div className="space-y-3 min-w-0">
              <ProjectActions
                project={selected}
                stats={selectedStats}
                onUpdate={updateProject}
                onAskDelete={() => setDeleteTarget(selected)}
              />
              <ProjectDetail
                project={selected}
                stats={selectedStats}
                transactions={byProject.get(selected.id) ?? []}
                allTransactions={transactions}
                categories={categories}
                projects={projects.filter((p) => p.status === 'active')}
                accountNames={accountNames}
                memberNames={memberOptions}
                rules={rules}
                onUpdate={updateTransaction}
                onDelete={deleteTransaction}
                onBatchUpdate={batchUpdate}
                onBatchReconcile={batchUpdateReconciled}
                onCreateRule={handleCreateRule}
                onDeleteRule={deleteRule}
              />
            </div>
          ) : (
            <div className="bg-bg-card border border-border rounded-card p-8 text-center">
              <p className="text-body text-text-secondary">Selecione um projeto à esquerda.</p>
            </div>
          )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Excluir "${deleteTarget.name}"?`}
          message="O projeto some da lista. Os lançamentos não são apagados — apenas deixam de estar vinculados a ele."
          confirmLabel="Excluir"
          destructive
          onConfirm={async () => { await deleteProject(deleteTarget.id); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/** Item da lista: só o que serve para comparar projetos de relance. */
function ProjectListItem({ project, stats, selected, onSelect }: {
  project: Project;
  stats?: ProjectStats;
  selected: boolean;
  onSelect: () => void;
}) {
  const spent = Math.abs(stats?.expense ?? 0);
  const fx = stats?.byCurrency[0];
  return (
    <button
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`w-full text-left p-3 rounded-card border transition-colors ${
        selected
          ? 'bg-accent/5 border-accent'
          : 'bg-bg-card border-border hover:border-accent/50'
      } ${project.status === 'archived' ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
        <span className="text-body font-semibold text-text-primary truncate">{project.name}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-1">
        <span className="text-body font-bold text-text-primary tnum">{formatBRL0(spent)}</span>
        {fx && <span className="text-caption text-ink-3 tnum">{formatFx(fx.amount, fx.currency)}</span>}
      </div>
      <div className="mt-1.5">
        <BudgetRuler spent={spent} budget={project.budget ?? null} color={project.color} />
      </div>
      <p className="text-caption text-ink-3 mt-1">{stats?.count ?? 0} lançamentos</p>
    </button>
  );
}

/** Barra de ações do projeto aberto: editar cadastro, encerrar, excluir. */
function ProjectActions({ project, stats, onUpdate, onAskDelete }: {
  project: Project;
  stats: ProjectStats;
  onUpdate: (id: string, data: Partial<Project>) => Promise<void>;
  onAskDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const isArchived = project.status === 'archived';

  if (editing) {
    return (
      <ProjectForm
        initial={project}
        onCancel={() => setEditing(false)}
        onSubmit={async (data) => { await onUpdate(project.id, data); setEditing(false); }}
      />
    );
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-body rounded-control border border-border text-text-secondary hover:border-accent hover:text-accent"
      >
        <Pencil size={13} /> Editar projeto
      </button>
      <button
        onClick={() => onUpdate(project.id, {
          status: isArchived ? 'active' : 'archived',
          // Encerrar sem data de fim: sugere a data do último lançamento, que
          // é o fim de fato. Não sobrescreve uma data já preenchida à mão.
          ...(!isArchived && !project.endDate && stats.lastDate ? { endDate: stats.lastDate } : {}),
        })}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-body rounded-control border transition-colors ${
          isArchived
            ? 'border-accent-green/40 text-accent-green hover:bg-accent-green/10'
            : 'border-border text-text-secondary hover:border-accent-red/60 hover:text-accent-red'
        }`}
      >
        {isArchived ? <><RotateCcw size={13} /> Reativar</> : <><Archive size={13} /> Encerrar</>}
      </button>
      {stats.count === 0 && (
        <button
          onClick={onAskDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 text-body rounded-control border border-border text-text-secondary hover:border-accent-red/60 hover:text-accent-red"
        >
          <Trash2 size={13} /> Excluir
        </button>
      )}
    </div>
  );
}

type ProjectDraft = Omit<Project, 'id' | 'createdAt'>;

/** Formulário único de criação e edição — eram dois blocos quase idênticos
 *  (um no topo da página, outro dentro do card), com as mesmas regras de
 *  parse de orçamento e de data escritas duas vezes. */
function ProjectForm({ initial, onSubmit, onCancel }: {
  initial?: Project;
  onSubmit: (data: ProjectDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? PROJECT_COLORS[0]);
  const [startDate, setStartDate] = useState(initial?.startDate ? initial.startDate.toISOString().slice(0, 10) : '');
  const [endDate, setEndDate] = useState(initial?.endDate ? initial.endDate.toISOString().slice(0, 10) : '');
  const [budget, setBudget] = useState(initial?.budget != null ? String(initial.budget) : '');

  const inputClass = 'w-full px-3 py-2 bg-bg-secondary border border-border rounded-control text-text-primary text-body focus:outline-none focus:border-accent';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSubmit({
      name: name.trim(),
      color,
      status: initial?.status ?? 'active',
      startDate: startDate ? new Date(startDate + 'T00:00:00') : null,
      endDate: endDate ? new Date(endDate + 'T00:00:00') : null,
      budget: parseBudget(budget),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="bg-bg-card border border-accent/30 rounded-card p-4 space-y-3">
      <p className="text-title font-semibold text-text-primary">{initial ? 'Editar projeto' : 'Novo projeto'}</p>
      <div>
        <label htmlFor="proj-name" className="text-caption text-text-secondary block mb-1">Nome</label>
        <input
          id="proj-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Reforma cozinha, Viagem Europa..."
          className={inputClass}
        />
      </div>
      <div>
        <span className="text-caption text-text-secondary block mb-1">Cor</span>
        <div className="flex gap-2">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Cor ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="proj-start" className="text-caption text-text-secondary block mb-1">Data de início</label>
          <input id="proj-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="proj-end" className="text-caption text-text-secondary block mb-1">Data de fim</label>
          <input id="proj-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label htmlFor="proj-budget" className="text-caption text-text-secondary block mb-1">
          Orçamento total <span className="text-ink-3">(opcional)</span>
        </label>
        <input
          id="proj-budget"
          type="text"
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="Ex: 120000"
          className={inputClass}
        />
        <p className="text-caption text-ink-3 mt-1">
          Vira a régua de orçado x executado aqui e no dashboard. Sem orçamento, o projeto
          aparece só com o gasto acumulado.
        </p>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-bg-primary text-body font-bold rounded-control hover:opacity-90">
          <Check size={13} /> {initial ? 'Salvar' : 'Criar'}
        </button>
        <button type="button" onClick={onCancel} className="flex items-center gap-1.5 px-4 py-1.5 bg-bg-secondary border border-border text-text-secondary text-body rounded-control">
          <X size={13} /> Cancelar
        </button>
      </div>
    </form>
  );
}

export type { Transaction };

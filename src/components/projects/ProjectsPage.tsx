import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Archive, RotateCcw, Pencil, Check, X, FolderKanban, ChevronDown, ChevronRight,
} from 'lucide-react';
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
import { budgetLabel } from '../shared/budgetShared';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { ProjectDetail } from './ProjectDetail';
import { control, controlDanger, controlPrimary, sectionLabel } from './controls';
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
 *
 * ── Geometria (o que a primeira versão do layout errava) ───────────────────
 * 1. `max-w-[1440px]`: a mesma trava do Dashboard. Sem ela, num monitor de
 *    1920+ a linha de categoria virava um trilho de dois palmos com o nome
 *    num canto e o valor no outro.
 * 2. As duas colunas COMEÇAM NA MESMA LINHA. Os botões de ação moram DENTRO
 *    do cabeçalho do detalhe; quando moravam numa faixa solta acima dele, o
 *    card da direita nascia ~40px abaixo do primeiro card da lista e nada na
 *    tela se alinhava.
 * 3. Formulário em diálogo, não empurrando a página: como card inline, criar
 *    ou editar um projeto deslocava a grade inteira para baixo.
 */
export function ProjectsPage() {
  const { projects, loading, addProject, updateProject, deleteProject } = useProjects();
  const { transactions, updateTransaction, deleteTransaction, batchUpdate, batchUpdateReconciled } = useTransactions();
  const { categories, rules, addRule, deleteRule } = useCategories();
  const { accountNames } = useAccounts();
  const { titularNames } = useTitularMappings();
  const { memberNames } = useFamilyMembers();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** `'new'` = criar; um projeto = editar aquele. Fecha em null. */
  const [formTarget, setFormTarget] = useState<Project | 'new' | null>(null);
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

  const spentOf = (p: Project) => Math.abs(statsById.get(p.id)?.expense ?? 0);

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

  // Cabeçalho da página: o retrato de UMA linha do portfólio, para o título
  // não ficar sozinho num bloco de 60px de altura.
  const totalActive = active.reduce((s, p) => s + spentOf(p), 0);
  const totalCount = active.reduce((s, p) => s + (statsById.get(p.id)?.count ?? 0), 0);

  function handleCreateRule(description: string, categoryId: string) {
    return toggleCategoryRule({ rules, addRule, deleteRule }, description, categoryId);
  }

  /** Encerrar sem data de fim: sugere a data do último lançamento, que é o fim
   *  de fato. Não sobrescreve uma data já preenchida à mão. */
  function toggleArchived(project: Project, stats: ProjectStats) {
    const isArchived = project.status === 'archived';
    return updateProject(project.id, {
      status: isArchived ? 'active' : 'archived',
      ...(!isArchived && !project.endDate && stats.lastDate ? { endDate: stats.lastDate } : {}),
    });
  }

  if (loading) {
    return <div className="text-accent text-body animate-pulse">Carregando projetos...</div>;
  }

  return (
    <div className="max-w-[1680px] mx-auto space-y-4">
      <div className="flex items-end justify-between gap-x-4 gap-y-2 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-text-primary leading-tight">Projetos</h2>
          <p className="text-caption text-text-secondary tnum mt-1">
            {active.length === 0
              ? 'Nenhum projeto em andamento'
              : <>
                  {active.length} em andamento · {formatBRL0(totalActive)} gastos · {totalCount} lançamentos
                </>}
            {archived.length > 0 && <> · {archived.length} encerrado{archived.length !== 1 ? 's' : ''}</>}
          </p>
        </div>
        <button onClick={() => setFormTarget('new')} className={controlPrimary}>
          <Plus size={14} /> Novo projeto
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-card px-6 py-12 flex flex-col items-center text-center gap-3">
          <span className="text-ink-3" aria-hidden="true"><FolderKanban size={28} /></span>
          <div>
            <p className="text-title font-semibold text-text-primary">Nenhum projeto ainda</p>
            <p className="text-body text-text-secondary mt-1 max-w-md">
              Projeto agrupa despesas e receitas que têm começo e fim — uma reforma, uma viagem,
              um casamento — atravessando meses e cartões.
            </p>
          </div>
          <button onClick={() => setFormTarget('new')} className={`${controlPrimary} mt-1`}>
            <Plus size={14} /> Criar o primeiro projeto
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(15rem,17rem)_minmax(0,1fr)] gap-4 items-start">
          <ProjectList
            active={active}
            archived={archived}
            statsById={statsById}
            effectiveId={effectiveId}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((v) => !v)}
            onSelect={setSelectedId}
            totalSpent={totalActive}
          />

          {selected && selectedStats ? (
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
              onEdit={() => setFormTarget(selected)}
              actions={
                <>
                  <button onClick={() => setFormTarget(selected)} className={control}>
                    <Pencil size={13} /> Editar
                  </button>
                  <button
                    onClick={() => toggleArchived(selected, selectedStats)}
                    className={selected.status === 'archived'
                      ? `${control} border-accent-green/40 text-accent-green hover:bg-accent-green/10`
                      : controlDanger}
                  >
                    {selected.status === 'archived'
                      ? <><RotateCcw size={13} /> Reativar</>
                      : <><Archive size={13} /> Encerrar</>}
                  </button>
                  {selectedStats.count === 0 && (
                    <button onClick={() => setDeleteTarget(selected)} className={controlDanger}>
                      <Trash2 size={13} /> Excluir
                    </button>
                  )}
                </>
              }
            />
          ) : (
            <div className="bg-bg-card border border-border rounded-card px-6 py-12 text-center">
              <p className="text-body text-text-secondary">Selecione um projeto na lista ao lado.</p>
            </div>
          )}
        </div>
      )}

      {formTarget && (
        <ProjectFormDialog
          initial={formTarget === 'new' ? undefined : formTarget}
          onCancel={() => setFormTarget(null)}
          onSubmit={async (data) => {
            if (formTarget === 'new') await addProject(data);
            else await updateProject(formTarget.id, data);
            setFormTarget(null);
          }}
        />
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

/**
 * Coluna da esquerda: UM card com os projetos em linhas separadas por hairline,
 * e não uma pilha de cards soltos. Além de mais silencioso, é o que faz o topo
 * da lista bater com o topo do painel de detalhe — dois cards, mesma linha de
 * partida. O rodapé fecha a coluna com o total e o interruptor dos encerrados,
 * que é controle DA LISTA e vivia perdido no cabeçalho da página.
 */
function ProjectList({
  active, archived, statsById, effectiveId, showArchived, onToggleArchived, onSelect, totalSpent,
}: {
  active: Project[];
  archived: Project[];
  statsById: Map<string, ProjectStats>;
  effectiveId: string | null;
  showArchived: boolean;
  onToggleArchived: () => void;
  onSelect: (id: string) => void;
  totalSpent: number;
}) {
  return (
    <div className="bg-bg-card border border-border rounded-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-baseline justify-between gap-2">
        <p className={sectionLabel}>Em andamento</p>
        <span className="text-caption text-ink-3 tnum">{active.length}</span>
      </div>

      {active.length === 0 ? (
        <p className="px-4 py-5 text-caption text-ink-3">Nenhum projeto em andamento.</p>
      ) : (
        <div className="divide-y divide-border">
          {active.map((p) => (
            <ProjectListItem
              key={p.id}
              project={p}
              stats={statsById.get(p.id)}
              selected={p.id === effectiveId}
              onSelect={() => onSelect(p.id)}
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <>
          <button
            onClick={onToggleArchived}
            aria-expanded={showArchived}
            className={`w-full px-4 py-2.5 border-t border-border flex items-center gap-1.5 text-left ${sectionLabel} hover:text-text-secondary transition-colors`}
          >
            {showArchived ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Encerrados
            <span className="font-normal normal-case tracking-normal tnum">({archived.length})</span>
          </button>
          {showArchived && (
            <div className="divide-y divide-border border-t border-border">
              {archived.map((p) => (
                <ProjectListItem
                  key={p.id}
                  project={p}
                  stats={statsById.get(p.id)}
                  selected={p.id === effectiveId}
                  onSelect={() => onSelect(p.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <div className="px-4 py-2.5 border-t border-border flex items-baseline justify-between gap-2">
        <span className="text-caption text-ink-3">Total em andamento</span>
        <span className="text-caption font-semibold text-text-primary tnum">{formatBRL0(totalSpent)}</span>
      </div>
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
  const label = budgetLabel(spent, project.budget ?? null);
  return (
    <button
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`relative w-full text-left px-4 py-3 transition-colors ${
        selected ? 'bg-accent/8' : 'hover:bg-elevated/60'
      } ${project.status === 'archived' ? 'opacity-70' : ''}`}
    >
      {/* Trilho de seleção: o mesmo idioma do item ativo da barra lateral. Um
          contorno menta inteiro competia com a borda do card de detalhe. */}
      {selected && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" aria-hidden="true" />}

      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
        <span className="text-body font-semibold text-text-primary truncate">{project.name}</span>
      </div>

      <div className="flex items-baseline justify-between gap-2 mt-1.5">
        <span className="text-body font-bold text-text-primary tnum">{formatBRL0(spent)}</span>
        {fx && <span className="text-caption text-ink-3 tnum">{formatFx(fx.amount, fx.currency)}</span>}
      </div>

      <div className="mt-2">
        <BudgetRuler spent={spent} budget={project.budget ?? null} color={project.color} />
      </div>

      <div className="flex items-baseline justify-between gap-2 mt-1.5">
        <span className="text-caption text-ink-3 tnum">{stats?.count ?? 0} lançamentos</span>
        <span className={`text-caption tnum truncate ${label.cls}`}>{label.text}</span>
      </div>
    </button>
  );
}

type ProjectDraft = Omit<Project, 'id' | 'createdAt'>;

/**
 * Formulário único de criação e edição — eram dois blocos quase idênticos (um
 * no topo da página, outro dentro do card), com as mesmas regras de parse de
 * orçamento e de data escritas duas vezes.
 *
 * Em DIÁLOGO: como card inline ele empurrava a grade inteira para baixo (a
 * lista e o detalhe pulavam ~200px ao clicar em "Novo projeto") e, ao editar,
 * ocupava justamente a faixa que precisa manter as duas colunas alinhadas.
 * Acessibilidade no mesmo contrato do ConfirmDialog: role/aria-modal, Esc
 * fecha, foco preso dentro e clique no fundo cancela.
 */
function ProjectFormDialog({ initial, onSubmit, onCancel }: {
  initial?: Project;
  onSubmit: (data: ProjectDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? PROJECT_COLORS[0]);
  const [startDate, setStartDate] = useState(initial?.startDate ? initial.startDate.toISOString().slice(0, 10) : '');
  const [endDate, setEndDate] = useState(initial?.endDate ? initial.endDate.toISOString().slice(0, 10) : '');
  const [budget, setBudget] = useState(initial?.budget != null ? String(initial.budget) : '');
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const inputClass = 'w-full px-3 py-2 bg-bg-secondary border border-border rounded-control text-text-primary text-body focus:outline-none focus:border-accent';

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = formRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || !root.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || !root.contains(activeEl))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        color,
        status: initial?.status ?? 'active',
        startDate: startDate ? new Date(startDate + 'T00:00:00') : null,
        endDate: endDate ? new Date(endDate + 'T00:00:00') : null,
        budget: parseBudget(budget),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={onCancel}>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proj-form-title"
        className="w-full max-w-md bg-bg-card border border-border rounded-card p-5 space-y-4 my-auto"
      >
        <p id="proj-form-title" className="text-title font-bold text-text-primary">
          {initial ? 'Editar projeto' : 'Novo projeto'}
        </p>

        <div>
          <label htmlFor="proj-name" className="text-caption text-text-secondary block mb-1.5">Nome</label>
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
          <span className="text-caption text-text-secondary block mb-1.5">Cor</span>
          <div className="flex gap-2 flex-wrap">
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
            <label htmlFor="proj-start" className="text-caption text-text-secondary block mb-1.5">Data de início</label>
            <input id="proj-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="proj-end" className="text-caption text-text-secondary block mb-1.5">Data de fim</label>
            <input id="proj-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div>
          <label htmlFor="proj-budget" className="text-caption text-text-secondary block mb-1.5">
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
          <p className="text-caption text-ink-3 mt-1.5 leading-snug">
            Vira a régua de orçado x executado aqui e no dashboard. Sem orçamento, o projeto
            aparece só com o gasto acumulado.
          </p>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onCancel} className={control}>
            <X size={13} /> Cancelar
          </button>
          <button type="submit" disabled={!name.trim() || saving} className={`${controlPrimary} disabled:opacity-40`}>
            <Check size={13} /> {initial ? 'Salvar' : 'Criar projeto'}
          </button>
        </div>
      </form>
    </div>
  );
}

export type { Transaction };

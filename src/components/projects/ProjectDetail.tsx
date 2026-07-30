import { useMemo, useState, type ReactNode } from 'react';
import { LayoutDashboard, List, PieChart, TrendingUp, Search, ExternalLink, Download, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatBRL, formatBRL0, formatFx, formatDate, getMonthLabel } from '../../lib/utils';
import { CategoryIcon } from '../shared/CategoryIcon';
import { CategoryFilterCombobox } from '../shared/CategoryFilterCombobox';
import { BudgetRuler } from '../shared/BudgetRuler';
import { budgetLabel } from '../shared/budgetShared';
import { TransactionTable } from '../transactions/TransactionTable';
import { control, sectionLabel } from './controls';
import type { ProjectStats } from '../../lib/projectStats';
import type { Project, Transaction, Category, CategoryRule } from '../../types';

type Tab = 'resumo' | 'lancamentos' | 'categorias' | 'evolucao';

interface Props {
  project: Project;
  stats: ProjectStats;
  /** Lançamentos DESTE projeto, já filtrados pelo pai. */
  transactions: Transaction[];
  /** Base completa — a `TransactionTable` precisa dela para o modal de
   *  reembolso achar despesas candidatas de qualquer mês/projeto. */
  allTransactions: Transaction[];
  categories: Category[];
  projects: Project[];
  accountNames: string[];
  memberNames: string[];
  rules: CategoryRule[];
  onUpdate: (id: string, data: Partial<Transaction>) => void;
  onDelete: (id: string) => void;
  onBatchUpdate: (ids: string[], data: Partial<Transaction>) => Promise<void> | void;
  onBatchReconcile: (ids: string[], reconciled: boolean) => void;
  onCreateRule: (description: string, categoryId: string) => void;
  onDeleteRule: (ruleId: string) => Promise<void>;
  /** Botões de ciclo de vida do projeto (editar/encerrar/excluir), montados
   *  pela página — quem sabe mexer no cadastro é ela. Ficam na MESMA linha do
   *  cabeçalho que CSV/Abrir: fora do card, viravam uma faixa solta acima dele
   *  e o painel nascia desalinhado do primeiro card da lista. */
  actions?: ReactNode;
  /** Abre o formulário do projeto (o card de orçamento vazio convida a isso). */
  onEdit?: () => void;
}

/**
 * Painel do projeto selecionado.
 *
 * A aba "Lançamentos" monta a `TransactionTable` INTEIRA em vez de uma lista
 * própria. Era o buraco central da tela antiga: ela desenhava uma lista
 * somente-leitura, então dentro de um projeto não dava para corrigir uma
 * categoria, anexar nota, vincular reembolso nem editar em lote — tudo isso
 * já existe, pronto e testado, naquele componente. Reusá-lo também garante
 * que editar um lançamento aqui e na tela de Lançamentos faça exatamente a
 * mesma coisa, porque é literalmente o mesmo código.
 */
export function ProjectDetail({
  project, stats, transactions, allTransactions, categories, projects,
  accountNames, memberNames, rules,
  onUpdate, onDelete, onBatchUpdate, onBatchReconcile, onCreateRule, onDeleteRule,
  actions, onEdit,
}: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('resumo');
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  // Filtro local da aba Lançamentos. Espelha o comportamento da tela de
  // Lançamentos (categoria-pai arrasta as filhas), mas escopado ao projeto.
  const visible = useMemo(() => {
    let list = transactions;
    if (filterCategory === 'uncategorized') {
      list = list.filter((t) => !t.categoryId);
    } else if (filterCategory !== 'all') {
      const childIds = new Set(categories.filter((c) => c.parentId === filterCategory).map((c) => c.id));
      list = list.filter((t) => t.categoryId === filterCategory || childIds.has(t.categoryId || ''));
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) => t.description.toLowerCase().includes(q));
    return list;
  }, [transactions, categories, filterCategory, search]);

  /** CSV do projeto: o que está VISÍVEL (filtros aplicados), para exportar
   *  "só a hospedagem da viagem" sem precisar recortar depois. */
  function exportCsv() {
    const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '';
    const rows = [
      ['Data', 'Descrição', 'Categoria', 'Conta', 'Valor (R$)', 'Moeda', 'Valor na moeda', 'Taxa'].join(';'),
      ...visible.map((t) => [
        t.date.toLocaleDateString('pt-BR'),
        `"${t.description.replace(/"/g, '""')}"`,
        catName(t.categoryId),
        t.account,
        t.amount.toFixed(2).replace('.', ','),
        t.currencyFx ?? '',
        t.amountFx != null ? t.amountFx.toFixed(2).replace('.', ',') : '',
        t.fxRate != null ? t.fxRate.toFixed(4).replace('.', ',') : '',
      ].join(';')),
    ].join('\n');
    // BOM: sem ele o Excel em pt-BR abre os acentos quebrados.
    const blob = new Blob(['﻿' + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\w-]+/g, '-').toLowerCase()}-lancamentos.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Abre a tela de Lançamentos já filtrada neste projeto. Mês vai em "todos"
   *  de propósito: projeto cruza meses e o filtro de lá começa no mês
   *  corrente, o que esconderia uma viagem passada inteira. */
  function openInTransactions() {
    navigate(`/transacoes?projeto=${project.id}&mes=all`);
  }

  const spent = Math.abs(stats.expense);
  const hasBudget = project.budget != null && project.budget > 0;
  const hasFx = stats.byCurrency.length > 0;

  return (
    <div className="bg-bg-card border border-border rounded-card overflow-hidden min-w-0">
      {/* Cabeçalho: identidade à esquerda, todas as ações à direita, uma linha só. */}
      <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-x-4 gap-y-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
            <h3 className="text-title font-bold text-text-primary truncate">{project.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-caption font-semibold flex-shrink-0 ${
              project.status === 'archived'
                ? 'bg-text-secondary/10 text-text-secondary'
                : 'bg-accent-green/10 text-accent-green'
            }`}>
              {project.status === 'archived' ? 'Encerrado' : 'Em andamento'}
            </span>
          </div>
          <p className="text-caption text-text-secondary tnum mt-1.5">
            {stats.count} lançamento{stats.count !== 1 ? 's' : ''}
            {stats.firstDate && stats.lastDate && (
              <> · {formatDate(stats.firstDate)}–{formatDate(stats.lastDate)}</>
            )}
            {stats.count !== stats.countedCount && (
              <> · {stats.count - stats.countedCount} transferência{stats.count - stats.countedCount !== 1 ? 's' : ''} fora dos totais</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {actions}
          {actions && <span className="w-px self-stretch bg-border mx-1 hidden sm:block" aria-hidden="true" />}
          <button onClick={exportCsv} disabled={visible.length === 0} className={control}>
            <Download size={13} /> CSV
          </button>
          <button onClick={openInTransactions} className={control}>
            <ExternalLink size={13} /> Abrir em Transações
          </button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-border px-5 overflow-x-auto scroll-x">
        {([
          ['resumo', LayoutDashboard, 'Resumo'],
          ['lancamentos', List, `Lançamentos (${stats.count})`],
          ['categorias', PieChart, 'Por categoria'],
          ['evolucao', TrendingUp, 'Evolução'],
        ] as [Tab, React.ElementType, string][]).map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-body whitespace-nowrap transition-colors border-b-2 -mb-px ${
              tab === id
                ? 'text-accent border-accent font-semibold'
                : 'text-text-secondary border-transparent hover:text-text-primary hover:border-border'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === 'resumo' && (
          <div className="space-y-4">
            {/* Placar. O gasto em reais é o número que manda; a moeda vem ao
                lado como leitura paralela, nunca somada. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Kpi
                label="Gasto"
                value={formatBRL(-spent)}
                tone="text-accent-red"
                sub={stats.byCurrency.map((c) => formatFx(c.amount, c.currency)).join(' · ') || 'tudo em reais'}
                className="col-span-2 sm:col-span-1"
              />
              <Kpi
                label="Receitas e reembolsos"
                value={formatBRL(stats.income)}
                tone={stats.income > 0 ? 'text-accent-green' : 'text-text-secondary'}
                sub={stats.income > 0 ? 'entra abatendo o gasto' : 'nada recebido de volta'}
              />
              <Kpi
                label="Saldo do projeto"
                value={formatBRL(stats.balance)}
                tone={stats.balance >= 0 ? 'text-accent-green' : 'text-accent-red'}
                sub="receitas menos gasto"
              />
            </div>

            {/* Orçamento e câmbio dividem a faixa: são as duas leituras de
                contexto do gasto (contra o planejado, contra a moeda). */}
            <div className={`grid gap-3 ${hasFx ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
              <BudgetCard project={project} spent={spent} onEdit={onEdit} />
              {hasFx && <FxCard stats={stats} spent={spent} />}
            </div>

            {stats.byCategory.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={sectionLabel}>Onde foi o dinheiro</p>
                  {stats.byCategory.length > 5 && (
                    <button
                      onClick={() => setTab('categorias')}
                      className="flex items-center gap-1 text-caption text-text-secondary hover:text-accent transition-colors"
                    >
                      todas as {stats.byCategory.length} categorias <ArrowRight size={11} />
                    </button>
                  )}
                </div>
                {stats.byCategory.slice(0, 5).map((c) => (
                  <CategoryRow key={c.categoryId ?? 'none'} slice={c} />
                ))}
              </div>
            )}

            {!hasBudget && !hasFx && stats.byCategory.length === 0 && (
              <p className="text-body text-text-secondary py-4">
                Sem despesas neste projeto ainda.
              </p>
            )}
          </div>
        )}

        {tab === 'lancamentos' && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap items-center">
              <div className="relative flex-1 min-w-[180px] max-w-sm">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar na descrição..."
                  className="w-full pl-8 pr-3 py-1.5 bg-bg-secondary border border-border rounded-control text-text-primary text-body focus:outline-none focus:border-accent"
                />
              </div>
              <CategoryFilterCombobox
                categories={categories}
                value={filterCategory}
                onChange={setFilterCategory}
              />
              <span className="text-caption text-ink-3 tnum ml-auto">
                {visible.length} de {stats.count} lançamentos
              </span>
            </div>

            {visible.length === 0 ? (
              <p className="text-body text-text-secondary py-8 text-center">
                Nenhum lançamento com esses filtros.
              </p>
            ) : (
              <TransactionTable
                transactions={visible}
                allTransactions={allTransactions}
                categories={categories}
                projects={projects}
                accountNames={accountNames}
                memberNames={memberNames}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onBatchUpdate={onBatchUpdate}
                onBatchReconcile={onBatchReconcile}
                onCreateRule={onCreateRule}
                onDeleteRule={onDeleteRule}
                rules={rules}
              />
            )}
          </div>
        )}

        {tab === 'categorias' && (
          stats.byCategory.length === 0 ? (
            <p className="text-body text-text-secondary py-8 text-center">Nenhuma despesa categorizada ainda.</p>
          ) : (
            <div className="space-y-3">
              {stats.byCategory.map((c) => <CategoryRow key={c.categoryId ?? 'none'} slice={c} detailed />)}
              <p className="text-caption text-ink-3 tnum pt-2 border-t border-border/60">
                Total {formatBRL(spent)} em {stats.byCategory.length}{' '}
                {stats.byCategory.length === 1 ? 'categoria' : 'categorias'}
              </p>
            </div>
          )
        )}

        {tab === 'evolucao' && (
          stats.byMonth.length === 0 ? (
            <p className="text-body text-text-secondary py-8 text-center">Sem despesas para desenhar a curva.</p>
          ) : (
            <MonthBars months={stats.byMonth} color={project.color} />
          )
        )}
      </div>
    </div>
  );
}

/**
 * Tile de indicador — mesma anatomia dos sinais vitais do Dashboard (rótulo
 * mudo em caixa alta, número grande, contexto embaixo), para os dois placares
 * do app não parecerem de aplicativos diferentes.
 */
function Kpi({ label, value, sub, tone = 'text-text-primary', className = '' }: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={`bg-bg-secondary border border-border rounded-card px-3.5 py-3 flex flex-col gap-1 min-w-0 ${className}`}>
      <span className={`${sectionLabel} leading-tight`}>{label}</span>
      <span className={`text-[21px] sm:text-[24px] font-bold tracking-tight tnum leading-none truncate ${tone}`}>
        {value}
      </span>
      <span className="text-caption text-ink-3 tnum truncate">{sub ?? '—'}</span>
    </div>
  );
}

/**
 * Orçado x executado.
 *
 * Tudo o que é texto vem numa ÚNICA linha à esquerda, separado por pontos — e
 * não em pares `justify-between`. Quando o projeto não tem moeda estrangeira
 * este card ocupa a faixa inteira, e qualquer par ancorado nas duas pontas
 * (era "R$ 71.230 de R$ 60.000" numa e "estourou R$ 11.230" na outra) volta a
 * pôr um palmo de vazio entre o número e o seu contexto. A régua embaixo, sim,
 * quer toda a largura: barra comprida é barra legível.
 */
function BudgetCard({ project, spent, onEdit }: { project: Project; spent: number; onEdit?: () => void }) {
  const budget = project.budget != null && project.budget > 0 ? project.budget : null;
  const label = budgetLabel(spent, budget);

  return (
    <div className="bg-bg-secondary border border-border rounded-card px-3.5 py-3 space-y-2 min-w-0">
      <p className={sectionLabel}>Orçamento</p>

      {budget ? (
        <>
          <p className="text-body tnum">
            <span className="font-bold text-text-primary">{formatBRL0(spent)}</span>
            <span className="text-ink-3"> de {formatBRL0(budget)} · {Math.round((spent / budget) * 100)}% executado · </span>
            <span className={label.cls}>{label.text}</span>
          </p>
          <BudgetRuler spent={spent} budget={budget} color={project.color} />
        </>
      ) : (
        <p className="text-body text-text-secondary">
          Sem orçamento definido — só o gasto acumulado.
          {onEdit && (
            <>
              {' '}
              <button onClick={onEdit} className="text-accent hover:underline">
                definir orçamento
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Câmbio: a taxa média efetiva é o que responde "saiu caro?" — comparar com a
 *  cotação da época mostra o custo do spread. Mesma regra do card de orçamento:
 *  uma linha, tudo à esquerda. */
function FxCard({ stats, spent }: { stats: ProjectStats; spent: number }) {
  const withFx = stats.byCurrency.reduce((s, c) => s + c.brl, 0);
  const inBrl = spent - withFx;

  return (
    <div className="bg-bg-secondary border border-border rounded-card px-3.5 py-3 space-y-2 min-w-0">
      <p className={sectionLabel}>Gasto em moeda estrangeira</p>
      {stats.byCurrency.map((c) => (
        <p key={c.currency} className="text-body tnum">
          <span className="font-bold text-text-primary">{formatFx(c.amount, c.currency)}</span>
          <span className="text-ink-3">
            {' '}em {c.count} lançamento{c.count !== 1 ? 's' : ''} · {formatBRL0(c.brl)} · taxa média{' '}
            {c.averageRate != null ? `${formatBRL(c.averageRate)}/${c.currency}` : '—'}
          </span>
        </p>
      ))}
      {inBrl > 0.01 && (
        <p className="text-caption text-ink-3 tnum leading-snug">
          {formatBRL0(inBrl)} do gasto foi em reais (sem moeda registrada) e não entra neste total.
        </p>
      )}
    </div>
  );
}

/**
 * Linha de categoria. A GEOMETRIA é o ponto, e é o que a versão anterior errava:
 * nome numa ponta da tela, valor na outra, meio metro de vazio no meio quando a
 * janela é larga. Aqui a ordem é NOME → VALOR → % → BARRA, com o nome numa
 * coluna de largura fixa: o valor fica sempre encostado no nome (é o par que se
 * lê junto), as barras começam todas na mesma vertical — o que as torna
 * comparáveis — e é a BARRA, no fim da linha, que absorve toda a sobra de
 * largura. Nada precisa de vão em branco para se alinhar.
 *
 * No celular a linha quebra em duas: nome e valor em cima, barra e % embaixo.
 * `detailed` acrescenta contagem e valor em moeda — na aba própria há espaço.
 */
function CategoryRow({ slice, detailed }: { slice: ProjectStats['byCategory'][number]; detailed?: boolean }) {
  return (
    <div
      className={`grid items-center gap-x-3 gap-y-1.5 grid-cols-[1rem_minmax(0,1fr)_auto] ${
        // Na aba própria o nome da categoria merece largura (há nomes de 35
        // caracteres no cadastro); no resumo, quanto mais curta a coluna,
        // mais perto o valor fica do nome.
        detailed
          ? 'sm:grid-cols-[1rem_minmax(0,21rem)_7rem_2.5rem_minmax(4rem,1fr)]'
          : 'sm:grid-cols-[1rem_minmax(0,13rem)_7rem_2.5rem_minmax(4rem,1fr)]'
      }`}
    >
      <CategoryIcon icon={slice.icon} size={14} style={{ color: slice.color }} />

      <span
        className="col-start-2 row-start-1 text-body text-text-primary truncate"
        title={slice.name}
      >
        {slice.name}
      </span>

      <span className="col-start-3 row-start-1 text-body font-bold text-text-primary tnum text-right">
        {formatBRL(slice.brl)}
      </span>

      <span className="col-start-3 row-start-2 sm:col-start-4 sm:row-start-1 text-caption text-ink-3 tnum text-right">
        {Math.round(slice.share * 100)}%
      </span>

      <div className="col-start-2 row-start-2 sm:col-start-5 sm:row-start-1 h-1.5 rounded-full bg-elevated overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, slice.share * 100)}%`, backgroundColor: slice.color }}
        />
      </div>

      {detailed && (
        <p className="col-start-2 col-span-2 row-start-3 sm:col-start-2 sm:col-span-4 sm:row-start-2 text-caption text-ink-3 tnum">
          {slice.count} lançamento{slice.count !== 1 ? 's' : ''}
          {slice.fx.map((f) => <span key={f.currency}> · {formatFx(f.amount, f.currency)}</span>)}
        </p>
      )}
    </div>
  );
}

/**
 * Barras por mês. Deliberadamente em CSS puro, sem biblioteca de gráfico: são
 * poucas barras de uma série só, e o Recharts aqui custaria bundle e um
 * container responsivo para desenhar o que uma div com largura percentual
 * já resolve. A escala é relativa ao mês de maior gasto.
 */
function MonthBars({ months, color }: { months: ProjectStats['byMonth']; color: string }) {
  const max = Math.max(...months.map((m) => m.brl), 1);
  const total = months.reduce((s, m) => s + m.brl, 0);
  const peak = months.reduce((a, m) => (m.brl > a.brl ? m : a), months[0]);

  return (
    <div className="space-y-2">
      {months.map((m) => (
        <div
          key={m.monthYear}
          className="grid items-center gap-x-3 grid-cols-[minmax(0,1fr)_6rem] sm:grid-cols-[8rem_7rem_minmax(4rem,1fr)]"
        >
          <span className="text-caption text-text-secondary truncate" title={getMonthLabel(m.monthYear)}>
            {getMonthLabel(m.monthYear)}
          </span>
          <span className="text-body font-bold text-text-primary tnum text-right">
            {formatBRL(m.brl)}
          </span>
          {/* Mesma ordem da linha de categoria: rótulo, valor, e a barra
              fechando a linha com toda a sobra de largura. */}
          <div className="col-span-2 sm:col-span-1 h-5 sm:h-4 rounded bg-elevated overflow-hidden">
            <div
              className="h-full rounded transition-all"
              style={{ width: `${(m.brl / max) * 100}%`, backgroundColor: color, opacity: m === peak ? 1 : 0.7 }}
            />
          </div>
        </div>
      ))}
      <p className="pt-2 border-t border-border/60 text-caption text-ink-3 tnum">
        Total {formatBRL(total)} em {months.length} {months.length === 1 ? 'mês' : 'meses'} ·
        média de {formatBRL0(total / months.length)} por mês · pico em {getMonthLabel(peak.monthYear)}
      </p>
    </div>
  );
}

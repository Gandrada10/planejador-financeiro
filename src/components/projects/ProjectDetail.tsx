import { useMemo, useState } from 'react';
import { LayoutDashboard, List, PieChart, TrendingUp, Search, ExternalLink, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatBRL, formatFx, formatDate, getMonthLabel } from '../../lib/utils';
import { CategoryIcon } from '../shared/CategoryIcon';
import { CategoryFilterCombobox } from '../shared/CategoryFilterCombobox';
import { BudgetRuler } from '../shared/BudgetRuler';
import { TransactionTable } from '../transactions/TransactionTable';
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

  return (
    <div className="bg-bg-card border border-border rounded-card overflow-hidden">
      {/* Cabeçalho */}
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
            <h3 className="text-title font-semibold text-text-primary truncate">{project.name}</h3>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              project.status === 'archived' ? 'bg-text-secondary/10 text-text-secondary' : 'bg-accent-green/10 text-accent-green'
            }`}>
              {project.status === 'archived' ? 'Encerrado' : 'Em andamento'}
            </span>
          </div>
          <p className="text-caption text-text-secondary mt-1">
            {stats.count} lançamento{stats.count !== 1 ? 's' : ''}
            {stats.firstDate && stats.lastDate && (
              <> · {formatDate(stats.firstDate)}–{formatDate(stats.lastDate)}</>
            )}
            {stats.count !== stats.countedCount && (
              <> · {stats.count - stats.countedCount} transferência{stats.count - stats.countedCount !== 1 ? 's' : ''} fora dos totais</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            disabled={visible.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-body rounded-control border border-border text-text-secondary hover:border-accent hover:text-accent disabled:opacity-40"
          >
            <Download size={13} /> CSV
          </button>
          <button
            onClick={openInTransactions}
            className="flex items-center gap-1.5 px-3 py-1.5 text-body rounded-control border border-border text-text-secondary hover:border-accent hover:text-accent"
          >
            <ExternalLink size={13} /> Abrir em Transações
          </button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-border px-4">
        {([
          ['resumo', LayoutDashboard, 'Resumo'],
          ['lancamentos', List, `Lançamentos (${stats.count})`],
          ['categorias', PieChart, 'Por categoria'],
          ['evolucao', TrendingUp, 'Evolução'],
        ] as [Tab, React.ElementType, string][]).map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-body rounded-t-control transition-colors border-b-2 -mb-px ${
              tab === id
                ? 'text-accent border-accent bg-accent/5'
                : 'text-text-secondary border-transparent hover:text-text-primary hover:border-border'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === 'resumo' && (
          <div className="space-y-4">
            {/* Placar. O gasto em reais é o número que manda; a moeda vem ao
                lado como leitura paralela, nunca somada. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Gasto" value={formatBRL(-spent)} tone="red" sub={
                stats.byCurrency.map((c) => formatFx(c.amount, c.currency)).join(' · ') || undefined
              } />
              <Kpi label="Receitas e reembolsos" value={formatBRL(stats.income)} tone="green" />
              <Kpi label="Saldo" value={formatBRL(stats.balance)} tone={stats.balance >= 0 ? 'green' : 'red'} />
              <Kpi
                label="Orçamento"
                value={project.budget != null && project.budget > 0 ? formatBRL(project.budget) : '—'}
                sub={project.budget != null && project.budget > 0
                  ? `${Math.round((spent / project.budget) * 100)}% executado`
                  : 'sem orçamento definido'}
              />
            </div>

            {project.budget != null && project.budget > 0 && (
              <BudgetRuler spent={spent} budget={project.budget} color={project.color} withLabel />
            )}

            {/* Câmbio: a taxa média efetiva é o que responde "saiu caro?" —
                comparar com a cotação da época mostra o custo do spread. */}
            {stats.byCurrency.length > 0 && (
              <div className="bg-bg-secondary border border-border rounded-card p-3 space-y-1">
                <p className="text-caption text-ink-3 uppercase tracking-wider">Gasto em moeda estrangeira</p>
                {stats.byCurrency.map((c) => (
                  <p key={c.currency} className="text-body text-text-primary tnum">
                    <b>{formatFx(c.amount, c.currency)}</b> em {c.count} lançamento{c.count !== 1 ? 's' : ''} ·{' '}
                    {formatBRL(c.brl)} · taxa média{' '}
                    {c.averageRate != null ? `${formatBRL(c.averageRate)}/${c.currency}` : '—'}
                  </p>
                ))}
                {spent > stats.byCurrency.reduce((s, c) => s + c.brl, 0) + 0.01 && (
                  <p className="text-caption text-ink-3">
                    {formatBRL(spent - stats.byCurrency.reduce((s, c) => s + c.brl, 0))} do gasto foi em reais
                    (sem moeda registrada) e não entra nos totais acima.
                  </p>
                )}
              </div>
            )}

            {/* Top 5 categorias — o resto está na aba própria. */}
            {stats.byCategory.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-caption text-ink-3 uppercase tracking-wider">Onde foi o dinheiro</p>
                {stats.byCategory.slice(0, 5).map((c) => (
                  <CategoryRow key={c.categoryId ?? 'none'} slice={c} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'lancamentos' && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap items-center">
              <div className="relative flex-1 min-w-[180px]">
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
              <span className="text-caption text-text-secondary">
                {visible.length} de {stats.count}
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
            <div className="space-y-1.5">
              {stats.byCategory.map((c) => <CategoryRow key={c.categoryId ?? 'none'} slice={c} detailed />)}
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

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' }) {
  return (
    <div className="bg-bg-secondary border border-border rounded-card p-3">
      <p className="text-caption text-text-secondary">{label}</p>
      <p className={`text-title font-bold tnum ${
        tone === 'red' ? 'text-accent-red' : tone === 'green' ? 'text-accent-green' : 'text-text-primary'
      }`}>{value}</p>
      {sub && <p className="text-caption text-ink-3 tnum">{sub}</p>}
    </div>
  );
}

/** Linha de categoria com barra proporcional. `detailed` acrescenta contagem
 *  e o valor em moeda — na aba própria há espaço, no resumo não. */
function CategoryRow({ slice, detailed }: { slice: ProjectStats['byCategory'][number]; detailed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <CategoryIcon icon={slice.icon} size={14} style={{ color: slice.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-body text-text-primary truncate">{slice.name}</span>
          <span className="text-body font-bold text-text-primary tnum flex-shrink-0">{formatBRL(slice.brl)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="h-1.5 rounded-full bg-elevated overflow-hidden flex-1 mt-1">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, slice.share * 100)}%`, backgroundColor: slice.color }} />
          </div>
          <span className="text-caption text-ink-3 tnum flex-shrink-0 w-10 text-right">
            {Math.round(slice.share * 100)}%
          </span>
        </div>
        {detailed && (
          <p className="text-caption text-ink-3 tnum">
            {slice.count} lançamento{slice.count !== 1 ? 's' : ''}
            {slice.fx.map((f) => <span key={f.currency}> · {formatFx(f.amount, f.currency)}</span>)}
          </p>
        )}
      </div>
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
  return (
    <div className="space-y-2">
      {months.map((m) => (
        <div key={m.monthYear} className="flex items-center gap-3">
          <span className="text-caption text-text-secondary w-20 flex-shrink-0">{getMonthLabel(m.monthYear)}</span>
          <div className="flex-1 h-5 rounded bg-elevated overflow-hidden">
            <div
              className="h-full rounded transition-all"
              style={{ width: `${(m.brl / max) * 100}%`, backgroundColor: color, opacity: 0.85 }}
            />
          </div>
          <span className="text-body font-bold text-text-primary tnum w-28 text-right flex-shrink-0">
            {formatBRL(m.brl)}
          </span>
        </div>
      ))}
      <p className="text-caption text-ink-3 pt-1 border-t border-border/40 text-right tnum">
        Total {formatBRL(total)} em {months.length} {months.length === 1 ? 'mês' : 'meses'}
      </p>
    </div>
  );
}

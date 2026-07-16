import { ChevronDown, ChevronUp, Trash2, CheckCircle2, ArrowUp, ArrowDown, ArrowUpDown, MoveRight, Zap, Pencil, RefreshCcw, Clock, Search, X } from 'lucide-react';
import { useState, useMemo } from 'react';
import { formatBRL, formatDate, tabNavigate, getMonthLabel, parseMoneyInput, applyMoneyMask, cn, isIncomeAmount, isExpenseAmount, isReimbursementTx, amountMatchesQuery, countsInTotals, getExcludedFromTotalsIds } from '../../lib/utils';
import { reimbursementSummaryByExpense, toCents, unallocatedReimbursementAmount } from '../../lib/accounting';
import type { Transaction, Category, Project, CategoryRule } from '../../types';
import { CategoryCombobox } from '../shared/CategoryCombobox';
import { NoteTag } from '../shared/NoteTag';
import { BatchEditModal } from '../shared/BatchEditModal';
import { ReimbursementLinkModal } from '../shared/ReimbursementLinkModal';

interface TitularGroup {
  titular: string;
  total: number;
  transactions: Transaction[];
}

interface Props {
  groups: TitularGroup[];
  categories: Category[];
  projects?: Project[];
  /** Todas as transações do sistema — para o modal de reembolso achar
   *  despesas de qualquer conta/mês (não só as da fatura atual). O nome evita
   *  colidir com o `allTransactions` interno, que é só a fatura. */
  everyTransaction?: Transaction[];
  totalTransactions: number;
  availableMonths?: string[];
  currentMonthYear?: string;
  memberNames?: string[];
  onUpdate?: (id: string, data: Partial<Transaction>) => void;
  onDelete?: (id: string) => void;
  onBatchReconcile?: (ids: string[], reconciled: boolean) => void;
  onBatchMove?: (ids: string[], targetMonthYear: string) => Promise<void>;
  onBatchUpdate?: (ids: string[], data: Partial<Transaction>) => Promise<void> | void;
  checkClosedCycle?: (transaction: Transaction) => { cycleId: string; label: string } | null;
  reopenCycle?: (cycleId: string) => Promise<void>;
  onCreateRule?: (description: string, categoryId: string) => void;
  onDeleteRule?: (ruleId: string) => Promise<void>;
  rules?: CategoryRule[];
}

export function InvoiceTransactionList({ groups, categories, projects = [], everyTransaction, totalTransactions, availableMonths = [], currentMonthYear, memberNames = [], onUpdate, onDelete, onBatchReconcile, onBatchMove, onBatchUpdate, checkClosedCycle, reopenCycle, onCreateRule, onDeleteRule, rules = [] }: Props) {
  const [reimbTx, setReimbTx] = useState<Transaction | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<'purchaseDate' | 'date'>('purchaseDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterPending, setFilterPending] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [searchText, setSearchText] = useState('');
  const [showMovePanel, setShowMovePanel] = useState(false);
  const [moveTargetMonth, setMoveTargetMonth] = useState('');
  const [movingIds, setMovingIds] = useState(false);
  const [showBatchEdit, setShowBatchEdit] = useState(false);

  function toggleSort(field: 'purchaseDate' | 'date') {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortIcon({ field }: { field: 'purchaseDate' | 'date' }) {
    if (sortField !== field) return <ArrowUpDown size={9} className="inline ml-0.5 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp size={9} className="inline ml-0.5 text-accent" />
      : <ArrowDown size={9} className="inline ml-0.5 text-accent" />;
  }

  const allTransactions = useMemo(() => groups.flatMap((g) => g.transactions), [groups]);

  // Visão reversa dos reembolsos (quanto cada despesa já teve abatido) — para
  // os chips "R$X de R$Y" e o estado "reembolsada". Sempre sobre a base
  // COMPLETA do sistema quando disponível (everyTransaction), não só a fatura.
  const reimbBase = everyTransaction ?? allTransactions;
  const reimbSummary = useMemo(() => reimbursementSummaryByExpense(reimbBase), [reimbBase]);
  const reimbBaseById = useMemo(() => new Map(reimbBase.map((x) => [x.id, x])), [reimbBase]);

  /** Chip de reembolso da linha (despesa abatida OU reembolso alocado). */
  function reimbChip(t: Transaction): React.ReactNode {
    const rs = t.amount < 0 ? reimbSummary.get(t.id) : undefined;
    if (rs) {
      const totalC = toCents(Math.abs(t.amount));
      const allocC = toCents(rs.allocated);
      const cls = allocC > totalC
        ? 'text-accent-red bg-accent-red/10'
        : allocC === totalC
          ? 'text-accent-green bg-accent-green/10'
          : 'text-amber-400 bg-amber-400/10';
      const srcList = rs.sources.map((x) => `${x.description} (${formatBRL(x.amount)})`).join(', ');
      return (
        <span
          className={`flex-shrink-0 px-1 rounded text-[10px] tnum leading-4 whitespace-nowrap ${cls}`}
          title={`Reembolsos abatidos nesta despesa: ${srcList}${allocC > totalC ? ' — EXCEDE o valor da despesa' : ''}`}
        >
          ↩ {formatBRL(rs.allocated)} de {formatBRL(Math.abs(t.amount))}
        </span>
      );
    }
    if (isReimbursementTx(t) && (t.reimbursementAllocations?.length ?? 0) > 0) {
      const allocs = t.reimbursementAllocations!;
      const partial = toCents(unallocatedReimbursementAmount(t)) > 0;
      const label = allocs.length === 1
        ? (reimbBaseById.get(allocs[0].expenseId)?.description ?? 'despesa apagada')
        : `${allocs.length} despesas`;
      return (
        <button
          onClick={(e) => { e.stopPropagation(); setReimbTx(t); }}
          className="flex-shrink-0 px-1 rounded text-[10px] leading-4 max-w-[140px] truncate bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          title="Este reembolso abate a(s) despesa(s) indicada(s) — clique para editar as alocações"
        >
          ↩ abate: {label}{partial ? ' · parcial' : ''}
        </button>
      );
    }
    return null;
  }

  // Ids fora-dos-totais ("Transferência") — mesma regra da CreditCardPage, para
  // recompor o total de cada grupo a partir das linhas VISÍVEIS quando um filtro
  // está ativo (senão o total do cabeçalho não bateria com o que aparece).
  const excludedIds = useMemo(() => getExcludedFromTotalsIds(categories), [categories]);

  // Filtered groups: tipo (receita/despesa) + busca (descrição/valor) + pendentes.
  // O total do grupo é recalculado sobre o subconjunto visível (excluindo
  // transferência, como no cálculo original) — sem filtro, dá o mesmo número.
  const displayGroups = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return groups
      .map((g) => {
        let txs = g.transactions;
        if (filterType === 'income') txs = txs.filter((t) => isIncomeAmount(t));
        else if (filterType === 'expense') txs = txs.filter((t) => isExpenseAmount(t));
        if (q) {
          txs = txs.filter(
            (t) =>
              t.description.toLowerCase().includes(q) ||
              (t.notes || '').toLowerCase().includes(q) ||
              amountMatchesQuery(t.amount, searchText)
          );
        }
        if (filterPending) txs = txs.filter((t) => !t.reconciled);
        const total = txs.filter((t) => countsInTotals(t, excludedIds)).reduce((s, t) => s + t.amount, 0);
        return { ...g, transactions: txs, total };
      })
      .filter((g) => g.transactions.length > 0);
  }, [groups, filterType, searchText, filterPending, excludedIds]);

  // Pending count based on what's currently visible (before the pending toggle itself)
  const pendingCount = useMemo(
    () => allTransactions.filter((t) => !t.reconciled).length,
    [allTransactions]
  );

  // Nº de lançamentos realmente visíveis após TODOS os filtros (tipo + busca +
  // pendentes) — para mostrar "X de Y" quando algo foi filtrado.
  const visibleCount = useMemo(
    () => displayGroups.reduce((s, g) => s + g.transactions.length, 0),
    [displayGroups]
  );

  // Quantos filtros estão ativos agora (tipo, busca, pendentes) — governa o
  // botão "Limpar filtros (N)", que zera todos de uma vez.
  const activeFilterCount =
    (filterType !== 'all' ? 1 : 0) +
    (searchText.trim() !== '' ? 1 : 0) +
    (filterPending ? 1 : 0);

  function clearAllFilters() {
    setFilterType('all');
    setSearchText('');
    setFilterPending(false);
  }

  function toggleGroup(titular: string) {
    const next = new Set(collapsed);
    if (next.has(titular)) next.delete(titular); else next.add(titular);
    setCollapsed(next);
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function toggleSelectAll() {
    const visible = displayGroups.flatMap((g) => g.transactions);
    const allSelected = visible.every((t) => selectedIds.has(t.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visible.map((t) => t.id)));
    }
  }

  function getCategoryLabel(catId: string | null): string {
    if (!catId) return '';
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return '';
    const parent = cat.parentId ? categories.find((c) => c.id === cat.parentId) : null;
    return parent ? `${parent.name}/${cat.name}` : cat.name;
  }

  async function guardClosedCycle(t: Transaction): Promise<boolean> {
    if (!checkClosedCycle || !reopenCycle) return true;
    const closed = checkClosedCycle(t);
    if (!closed) return true;
    const ok = window.confirm(
      `A fatura "${closed.label}" esta encerrada.\n\nDeseja reabri-la para editar esta transacao?`
    );
    if (!ok) return false;
    await reopenCycle(closed.cycleId);
    return true;
  }

  function startEdit(id: string, field: string, currentValue: string) {
    setEditingCell({ id, field });
    setEditValue(currentValue);
  }

  async function commitEdit(t: Transaction) {
    if (!editingCell || !onUpdate) return;
    const { field } = editingCell;

    const ok = await guardClosedCycle(t);
    if (!ok) { setEditingCell(null); return; }

    if (field === 'description' && editValue.trim()) {
      onUpdate(t.id, { description: editValue.trim() });
    } else if (field === 'amount') {
      // O campo de valor é mascarado na entrada (applyMoneyMask) e pré-preenchido
      // já no formato pt-BR canônico ("-8.022,48"), então parseMoneyInput sempre
      // recebe formato não-ambíguo. GUARD anti-lixo: parseMoneyInput cai em 0 pra
      // texto não numérico e este commit dispara no onBlur (Tab entre células),
      // então SEM dígito não commitamos — senão um typo tipo "," zeraria o valor
      // real da transação no blur, sem aviso.
      if (/\d/.test(editValue)) {
        const val = parseMoneyInput(editValue);
        onUpdate(t.id, { amount: val });
      }
    } else if (field === 'date' && editValue) {
      const d = new Date(editValue + 'T12:00:00');
      if (!isNaN(d.getTime())) onUpdate(t.id, { date: d });
    } else if (field === 'purchaseDate') {
      if (!editValue) {
        onUpdate(t.id, { purchaseDate: null });
      } else {
        const d = new Date(editValue + 'T12:00:00');
        if (!isNaN(d.getTime())) onUpdate(t.id, { purchaseDate: d });
      }
    } else if (field === 'installments') {
      const parts = editValue.split('/');
      const num = parseInt(parts[0]);
      const total = parseInt(parts[1]);
      if (!isNaN(num) && !isNaN(total)) {
        onUpdate(t.id, { installmentNumber: num, totalInstallments: total });
      } else if (!editValue.trim()) {
        onUpdate(t.id, { installmentNumber: null, totalInstallments: null });
      }
    }

    setEditingCell(null);
  }

  function handleKeyDown(e: React.KeyboardEvent, t: Transaction) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const cell = (e.target as HTMLElement).closest('[data-tab-cell]');
      commitEdit(t);
      if (e.key === 'Tab' && cell) {
        setTimeout(() => tabNavigate(cell as HTMLElement, e.shiftKey ? 'prev' : 'next'), 50);
      }
    }
    if (e.key === 'Escape') setEditingCell(null);
  }

  const editable = onUpdate ? 'cursor-pointer hover:bg-bg-secondary/50 transition-colors' : '';

  return (
    <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-text-primary">
            {visibleCount !== totalTransactions ? `${visibleCount} de ${totalTransactions}` : totalTransactions} lancamentos
          </span>
          {pendingCount > 0 && (
            <button
              onClick={() => setFilterPending(!filterPending)}
              className={`text-[10px] hover:underline ${filterPending ? 'text-accent font-bold' : 'text-accent'}`}
            >
              {pendingCount} pendentes conciliacao{filterPending && ' ✕'}
            </button>
          )}
          <span className="text-[10px] text-text-secondary">
            Ordenar:
            <button onClick={() => toggleSort('date')} className="ml-1 hover:text-text-primary" title="Data de pagamento/vencimento — define o mês no fluxo de caixa">
              Data <SortIcon field="date" />
            </button>
            <span className="mx-1">·</span>
            <button onClick={() => toggleSort('purchaseDate')} className="hover:text-text-primary" title="Data da compra efetiva (competência) — não define o mês">
              Competência <SortIcon field="purchaseDate" />
            </button>
          </span>
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {onBatchReconcile && (() => {
              const selList = allTransactions.filter((t) => selectedIds.has(t.id));
              const allRec = selList.every((t) => t.reconciled);
              return allRec ? (
                <button
                  onClick={() => { onBatchReconcile([...selectedIds], false); setSelectedIds(new Set()); }}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:underline"
                >
                  <CheckCircle2 size={12} /> Desconciliar ({selectedIds.size})
                </button>
              ) : (
                <button
                  onClick={() => { onBatchReconcile([...selectedIds], true); setSelectedIds(new Set()); }}
                  className="flex items-center gap-1 text-xs text-accent-green hover:underline"
                >
                  <CheckCircle2 size={12} /> Conciliar ({selectedIds.size})
                </button>
              );
            })()}
            {onBatchUpdate && (
              <button
                onClick={() => setShowBatchEdit(true)}
                className="flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <Pencil size={12} /> Edicao em lote ({selectedIds.size})
              </button>
            )}
            {onBatchMove && (
              <button
                onClick={() => { setShowMovePanel((v) => !v); setMoveTargetMonth(''); }}
                className="flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <MoveRight size={12} /> Mover para fatura ({selectedIds.size})
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => { selectedIds.forEach((id) => onDelete(id)); setSelectedIds(new Set()); }}
                className="flex items-center gap-1 text-xs text-accent-red hover:underline"
              >
                <Trash2 size={12} /> Excluir ({selectedIds.size})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filtros: tipo (receita/despesa) + busca por descrição/valor */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 flex-wrap">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as 'all' | 'income' | 'expense')}
          className={cn(
            'px-2.5 py-1.5 bg-bg-secondary border rounded text-xs focus:outline-none focus:border-accent',
            filterType !== 'all' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-primary'
          )}
        >
          <option value="all">Receitas e despesas</option>
          <option value="income">Só receitas</option>
          <option value="expense">Só despesas</option>
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className={cn('absolute left-2.5 top-2', searchText ? 'text-accent' : 'text-text-secondary')} />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Buscar por descricao ou valor..."
            className={cn(
              'w-full pl-8 pr-3 py-1.5 bg-bg-secondary border rounded text-xs focus:outline-none focus:border-accent',
              searchText ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-primary'
            )}
          />
        </div>
        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-accent whitespace-nowrap"
          >
            <X size={12} /> Limpar filtros ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Move to another invoice panel */}
      {showMovePanel && onBatchMove && (
        <div className="px-4 py-3 border-b border-border bg-accent/5 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-text-secondary">Mover {selectedIds.size} lançamento(s) para a fatura de:</span>
          <select
            value={moveTargetMonth}
            onChange={(e) => setMoveTargetMonth(e.target.value)}
            className="px-2 py-1 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
          >
            <option value="">Selecionar mês...</option>
            {availableMonths
              .filter((m) => m !== currentMonthYear)
              .map((m) => (
                <option key={m} value={m}>{getMonthLabel(m)}</option>
              ))}
          </select>
          <button
            disabled={!moveTargetMonth || movingIds}
            onClick={async () => {
              if (!moveTargetMonth) return;
              setMovingIds(true);
              await onBatchMove([...selectedIds], moveTargetMonth);
              setSelectedIds(new Set());
              setShowMovePanel(false);
              setMoveTargetMonth('');
              setMovingIds(false);
            }}
            className="px-3 py-1 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-40"
          >
            {movingIds ? 'Movendo...' : 'Confirmar'}
          </button>
          <button
            onClick={() => { setShowMovePanel(false); setMoveTargetMonth(''); }}
            className="text-xs text-text-secondary hover:text-text-primary"
          >
            Cancelar
          </button>
        </div>
      )}

      {showBatchEdit && onBatchUpdate && (
        <BatchEditModal
          count={selectedIds.size}
          categories={categories}
          projects={projects}
          memberNames={memberNames}
          fields={['categoryId', 'familyMember', 'projectId']}
          onApply={async (updates) => {
            const ids = [...selectedIds];
            if (checkClosedCycle && reopenCycle) {
              const closedMap = new Map<string, string>();
              for (const id of ids) {
                const t = allTransactions.find((x) => x.id === id);
                if (!t) continue;
                const closed = checkClosedCycle(t);
                if (closed) closedMap.set(closed.cycleId, closed.label);
              }
              if (closedMap.size > 0) {
                const labels = [...closedMap.values()].join('\n');
                const ok = window.confirm(
                  `As seguintes faturas estao encerradas:\n${labels}\n\nDeseja reabri-las para editar?`
                );
                if (!ok) return;
                for (const cycleId of closedMap.keys()) await reopenCycle(cycleId);
              }
            }
            await onBatchUpdate(ids, updates);
            setSelectedIds(new Set());
          }}
          onClose={() => setShowBatchEdit(false)}
        />
      )}

      {displayGroups.length === 0 ? (
        <div className="p-8 text-center text-text-secondary text-xs">
          {activeFilterCount > 0 ? 'Nenhuma transacao para o filtro atual' : 'Nenhuma transacao neste periodo'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {displayGroups.map((group) => {
            const isCollapsed = collapsed.has(group.titular);
            return (
              <div key={group.titular}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.titular)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-bg-secondary hover:bg-bg-secondary/80 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? <ChevronDown size={14} className="text-text-secondary" /> : <ChevronUp size={14} className="text-text-secondary" />}
                    <span className="text-xs font-bold text-text-primary">
                      {group.titular || 'Sem titular'}
                    </span>
                    {(() => {
                      const cardNum = group.transactions[0]?.cardNumber;
                      const last4 = cardNum ? cardNum.replace(/\D/g, '').slice(-4) : null;
                      return last4 ? (
                        <span className="text-[10px] text-text-secondary tnum">**** {last4}</span>
                      ) : null;
                    })()}
                  </div>
                  <span className="text-xs font-bold text-accent-red">{formatBRL(group.total)}</span>
                </button>

                {/* Transactions */}
                {!isCollapsed && (
                  <div className="divide-y divide-border/30">
                    {/* Column headers */}
                    <div className="flex items-center px-4 py-1.5 text-text-secondary uppercase tracking-wider text-[10px]">
                      <div className="w-6 flex-shrink-0 flex justify-center">
                        <div
                          tabIndex={0}
                          role="checkbox"
                          aria-checked={(() => {
                            const visible = displayGroups.flatMap((g) => g.transactions);
                            return visible.length > 0 && visible.every((t) => selectedIds.has(t.id));
                          })()}
                          className={`w-3 h-3 rounded-sm border cursor-pointer transition-colors ${
                            (() => {
                              const visible = displayGroups.flatMap((g) => g.transactions);
                              return visible.length > 0 && visible.every((t) => selectedIds.has(t.id))
                                ? 'bg-accent border-accent'
                                : selectedIds.size > 0
                                ? 'bg-accent/40 border-accent'
                                : 'border-text-secondary hover:border-accent';
                            })()
                          }`}
                          onClick={toggleSelectAll}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelectAll(); } }}
                          title="Selecionar todas"
                        />
                      </div>
                      <div className="w-[80px] flex-shrink-0" title="Data de pagamento/vencimento — muda ao lançar o pagamento da fatura; define o mês no fluxo de caixa">Data</div>
                      <div className="w-[80px] flex-shrink-0" title="Data da compra efetiva (competência) — não define o mês">Competência</div>
                      <div className="flex-1 min-w-0 max-w-[320px] px-2">Descricao</div>
                      <div className="flex-1 min-w-[200px] mr-2">Categoria</div>
                      <div className="flex-shrink-0 w-[110px] text-right mr-2">Valor</div>
                      <div className="flex-shrink-0 w-[65px] text-center mr-2">Parcelas</div>
                      <div className="flex-1 min-w-[130px]">Projeto</div>
                    </div>
                    {[...group.transactions].sort((a, b) => {
                      const av = sortField === 'date' ? a.date : (a.purchaseDate || a.date);
                      const bv = sortField === 'date' ? b.date : (b.purchaseDate || b.date);
                      const diff = av.getTime() - bv.getTime();
                      return sortDir === 'asc' ? diff : -diff;
                    }).map((t) => (
                      <div key={t.id} className="flex items-center px-4 py-2 hover:bg-bg-secondary/30 transition-colors group">
                        {/* Conciliação dot - tab-navigable */}
                        <div className="w-6 flex-shrink-0 flex justify-center" data-tab-cell>
                          <div
                            tabIndex={0}
                            role="checkbox"
                            aria-checked={selectedIds.has(t.id)}
                            className={`w-3.5 h-3.5 rounded-full border cursor-pointer transition-colors outline-none focus:ring-2 focus:ring-accent/50 ${
                              selectedIds.has(t.id)
                                ? 'bg-accent border-accent'
                                : t.reconciled
                                ? 'bg-accent-green border-accent-green'
                                : 'border-border hover:border-accent hover:bg-accent/20'
                            }`}
                            onClick={(e) => { e.stopPropagation(); toggleSelect(t.id); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleSelect(t.id);
                              } else if (e.key === 'Tab') {
                                e.preventDefault();
                                const cell = (e.target as HTMLElement).closest('[data-tab-cell]');
                                if (cell) tabNavigate(cell as HTMLElement, e.shiftKey ? 'prev' : 'next');
                              }
                            }}
                            title={t.reconciled ? 'Conciliado – Enter para selecionar' : 'Enter para selecionar'}
                          />
                        </div>

                        {/* Cash date (pagamento/vencimento) - editable. É a coluna
                            que a baixa da fatura sobrescreve com a data do
                            pagamento; governa o mês no fluxo de caixa. */}
                        <div
                          data-tab-cell
                          className={`text-xs text-text-primary w-[80px] flex-shrink-0 overflow-hidden truncate ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'date', t.date.toISOString().split('T')[0])}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'date' ? (
                            <input
                              autoFocus
                              type="date"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                            />
                          ) : formatDate(t.date)}
                        </div>

                        {/* Purchase date (competência) - editable */}
                        <div
                          data-tab-cell
                          className={`text-xs text-text-secondary w-[80px] flex-shrink-0 overflow-hidden truncate ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'purchaseDate', (t.purchaseDate || t.date).toISOString().split('T')[0])}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'purchaseDate' ? (
                            <input
                              autoFocus
                              type="date"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                            />
                          ) : formatDate(t.purchaseDate || t.date)}
                        </div>

                        {/* Description - editable */}
                        <div
                          data-tab-cell
                          className={`flex-1 min-w-0 max-w-[320px] px-2 overflow-hidden ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'description', t.description)}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'description' ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                            />
                          ) : (
                            <>
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-xs text-text-primary truncate">{t.description}</span>
                                <NoteTag
                                  note={t.notes || ''}
                                  onSave={(note) => onUpdate && onUpdate(t.id, { notes: note })}
                                />
                                {reimbChip(t)}
                              </div>
                              {t.categoryId && (
                                <p className="text-xs text-text-secondary truncate">
                                  {getCategoryLabel(t.categoryId)}
                                </p>
                              )}
                            </>
                          )}
                        </div>

                        {/* Category - combobox with autocomplete + tab navigation */}
                        {onUpdate ? (
                          <div className="flex-1 min-w-[200px] mr-2 flex items-center gap-1">
                            <CategoryCombobox
                              className="min-w-0 flex-1"
                              categories={categories}
                              // Reembolso abate uma DESPESA: oferece categorias
                              // de despesa mesmo com valor positivo (sentinela -1).
                              amount={t.isReimbursement ? -1 : t.amount}
                              value={t.categoryId}
                              onChange={async (val) => {
                                const ok = await guardClosedCycle(t);
                                if (!ok) return;
                                const existingRule = rules.find((r) => r.pattern.toLowerCase() === t.description.toLowerCase());
                                if (existingRule && onDeleteRule && val !== t.categoryId) {
                                  const confirm = window.confirm(
                                    `Existe uma regra de categorização para "${t.description}".\n\nAo mudar a categoria, a regra será removida. Deseja continuar?`
                                  );
                                  if (!confirm) return;
                                  await onDeleteRule(existingRule.id);
                                }
                                onUpdate && onUpdate(t.id, { categoryId: val });
                              }}
                              compact
                            />
                            {t.categoryId && onCreateRule && (() => {
                              const hasRule = rules.some((r) => r.pattern.toLowerCase() === t.description.toLowerCase());
                              return (
                                <button
                                  title={hasRule ? 'Remover regra existente' : 'Criar regra para esta descrição'}
                                  onClick={() => onCreateRule(t.description, t.categoryId!)}
                                  className={`flex-shrink-0 transition-colors ${
                                    hasRule
                                      ? 'text-yellow-400 hover:text-yellow-300'
                                      : 'text-text-secondary/30 hover:text-text-secondary'
                                  }`}
                                >
                                  <Zap size={12} />
                                </button>
                              );
                            })()}
                            {/* Reembolso (receita): abre modal p/ vincular. */}
                            {t.amount > 0 && (
                              <button
                                title={t.isReimbursement ? 'Reembolso — clique para editar as alocações' : 'Marcar como reembolso (abate uma ou mais despesas)'}
                                onClick={() => setReimbTx(t)}
                                className={`flex-shrink-0 transition-colors ${
                                  t.isReimbursement
                                    ? 'text-accent hover:text-accent/80'
                                    : 'text-text-secondary/60 hover:text-accent'
                                }`}
                              >
                                <RefreshCcw size={12} />
                              </button>
                            )}
                            {/* Aguardando reembolso (despesa): sinalizador de
                                intenção; quitada pelas alocações vira check verde
                                (continua clicável para desmarcar). */}
                            {t.amount < 0 && onUpdate && (() => {
                              const rs = reimbSummary.get(t.id);
                              const settled = !!t.awaitingReimbursement && !!rs && toCents(rs.allocated) >= toCents(Math.abs(t.amount));
                              return (
                                <button
                                  title={settled
                                    ? `Reembolsada — ${formatBRL(rs!.allocated)} recebidos (clique para desmarcar o aguardo)`
                                    : t.awaitingReimbursement
                                      ? 'Aguardando reembolso — clique para desmarcar'
                                      : 'Marcar: aguardando reembolso (espera receber de volta)'}
                                  onClick={() => onUpdate(t.id, { awaitingReimbursement: !t.awaitingReimbursement })}
                                  className={`flex-shrink-0 transition-colors ${
                                    settled
                                      ? 'text-accent-green hover:text-accent-green/80'
                                      : t.awaitingReimbursement
                                        ? 'text-accent hover:text-accent/80'
                                        : 'text-text-secondary/60 hover:text-accent'
                                  }`}
                                >
                                  {settled ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                                </button>
                              );
                            })()}
                          </div>
                        ) : null}

                        {/* Amount - editable */}
                        <div
                          data-tab-cell
                          className={`text-xs font-bold flex-shrink-0 w-[110px] text-right overflow-hidden mr-2 ${isReimbursementTx(t) ? 'text-accent' : t.amount >= 0 ? 'text-accent-green' : 'text-accent-red'} ${editable}`}
                          // Pré-preenche já no formato mascarado pt-BR: toFixed(2)
                          // garante 2 casas p/ o applyMoneyMask (que lê os dígitos
                          // como centavos) reconstruir certo — -8022.48 → "-8.022,48",
                          // -90 → "-90,00" (não "-0,90").
                          onClick={() => onUpdate && startEdit(t.id, 'amount', applyMoneyMask(t.amount.toFixed(2)))}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'amount' ? (
                            <input
                              autoFocus
                              inputMode="decimal"
                              value={editValue}
                              onChange={(e) => setEditValue(applyMoneyMask(e.target.value))}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs text-right focus:outline-none"
                            />
                          ) : (
                            formatBRL(t.amount)
                          )}
                        </div>

                        {/* Parcelas - editable, separate column */}
                        <div
                          data-tab-cell
                          className={`flex-shrink-0 w-[65px] text-center overflow-hidden mr-2 ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'installments', t.totalInstallments ? `${t.installmentNumber ?? 1}/${t.totalInstallments}` : '')}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'installments' ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              placeholder="1/12"
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-[10px] text-center focus:outline-none"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : t.totalInstallments ? (
                            <span className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded tnum">
                              {t.installmentNumber}/{t.totalInstallments}
                            </span>
                          ) : (
                            <span className="text-[10px] text-text-secondary">—</span>
                          )}
                        </div>

                        {/* Projeto */}
                        {onUpdate ? (
                          <div className="flex-1 min-w-[130px] overflow-hidden">
                            <select
                              tabIndex={-1}
                              value={t.projectId || ''}
                              onChange={async (e) => {
                                const value = e.target.value;
                                const ok = await guardClosedCycle(t);
                                if (!ok) return;
                                onUpdate(t.id, { projectId: value || null });
                              }}
                              className="w-full bg-transparent border-none text-xs cursor-pointer focus:outline-none hover:text-text-primary truncate"
                              style={{ color: projects.find((p) => p.id === t.projectId)?.color || 'var(--color-text-secondary)' }}
                            >
                              <option value="" style={{ backgroundColor: '#111111', color: '#e5e5e5' }}>—</option>
                              {projects.filter((p) => p.status === 'active').map((p) => (
                                <option key={p.id} value={p.id} style={{ backgroundColor: '#111111', color: p.color }}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        {/* Delete */}
                        {onDelete && (
                          <button
                            tabIndex={-1}
                            onClick={async () => {
                              const ok = await guardClosedCycle(t);
                              if (!ok) return;
                              onDelete(t.id);
                            }}
                            className="ml-2 text-text-secondary hover:text-accent-red flex-shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {reimbTx && onUpdate && (
        <ReimbursementLinkModal
          transaction={reimbTx}
          allTransactions={everyTransaction ?? allTransactions}
          categories={categories}
          onUpdate={onUpdate}
          onClose={() => setReimbTx(null)}
        />
      )}
    </div>
  );
}

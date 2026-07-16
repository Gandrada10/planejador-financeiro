import { useState, useMemo, Fragment } from 'react';
import { X, Search, RefreshCcw, Clock, Trash2, AlertTriangle } from 'lucide-react';
import type { Transaction, Category } from '../../types';
import { formatBRL, formatDate, getMonthLabel, getMonthYear, applyMoneyMask, parseMoneyInput } from '../../lib/utils';
import { reimbursementSummaryByExpense, toCents } from '../../lib/accounting';

interface Props {
  /** O reembolso sendo configurado (valor positivo). */
  transaction: Transaction;
  /** Todas as transações — para achar despesas candidatas de qualquer mês. */
  allTransactions: Transaction[];
  categories: Category[];
  onUpdate: (id: string, data: Partial<Transaction>) => void;
  onClose: () => void;
}

interface AllocationRow {
  expenseId: string;
  amountStr: string;
}

/**
 * Editor de ALOCAÇÕES de um reembolso (N↔N): distribui o valor entre uma ou
 * mais despesas, cada fatia abatendo a despesa-alvo no mês/categoria dela
 * (ver `lib/accounting.ts`). Regras de bloqueio (duras, sem confirmação de
 * exceção): uma fatia nunca excede o saldo restante da despesa (valor − o que
 * outros reembolsos já abateram) e a soma das fatias nunca excede o valor do
 * reembolso. Salvar NÃO mexe na categoria do reembolso — a categoria do alvo
 * é herdada dinamicamente nos totais.
 */
export function ReimbursementLinkModal({ transaction, allTransactions, categories, onUpdate, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [rows, setRows] = useState<AllocationRow[]>(() =>
    (transaction.reimbursementAllocations ?? []).map((a) => ({
      expenseId: a.expenseId,
      amountStr: applyMoneyMask(a.amount.toFixed(2)),
    }))
  );

  const byId = useMemo(() => new Map(allTransactions.map((t) => [t.id, t])), [allTransactions]);

  // Quanto cada despesa JÁ tem abatido por TODOS os reembolsos (inclui os
  // deste). Para o teto por fatia interessa o abatido pelos OUTROS: subtrai a
  // contribuição salva deste reembolso, já que as linhas do editor a substituem.
  const summary = useMemo(() => reimbursementSummaryByExpense(allTransactions), [allTransactions]);
  const savedByExpense = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of transaction.reimbursementAllocations ?? []) {
      m.set(a.expenseId, (m.get(a.expenseId) ?? 0) + toCents(a.amount));
    }
    return m;
  }, [transaction.reimbursementAllocations]);

  /** Centavos já abatidos na despesa por reembolsos que NÃO são este. */
  function othersCents(expenseId: string): number {
    return toCents(summary.get(expenseId)?.allocated ?? 0) - (savedByExpense.get(expenseId) ?? 0);
  }

  /** Teto (centavos) de uma fatia para esta despesa: saldo que sobra dos outros. */
  function capCents(expense: Transaction): number {
    return Math.max(0, toCents(Math.abs(expense.amount)) - othersCents(expense.id));
  }

  const reimbCents = toCents(transaction.amount);
  const rowCents = (r: AllocationRow) => toCents(parseMoneyInput(r.amountStr));
  const totalRowsCents = rows.reduce((s, r) => s + rowCents(r), 0);
  const remainingCents = reimbCents - totalRowsCents;

  // Erros de bloqueio (desabilitam o Salvar, com explicação):
  const rowErrors = rows.map((r) => {
    const expense = byId.get(r.expenseId);
    if (!expense) return 'Despesa não encontrada (apagada) — remova esta linha.';
    const v = rowCents(r);
    if (v <= 0) return 'Informe o valor da fatia.';
    if (v > capCents(expense)) {
      return `Excede o saldo desta despesa (${formatBRL(capCents(expense) / 100)}).`;
    }
    return null;
  });
  const overTotal = totalRowsCents > reimbCents;
  const blockReason = overTotal
    ? `A soma das fatias (${formatBRL(totalRowsCents / 100)}) passa do valor do reembolso (${formatBRL(transaction.amount)}).`
    : rowErrors.find((e) => e !== null) ?? null;

  // Meses que têm despesas — para o seletor. Com muitas transações no mês
  // corrente, uma lista só cronológica nunca alcança meses antigos; o seletor
  // deixa escolher qualquer mês diretamente.
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTransactions) if (t.amount < 0) set.add(getMonthYear(t.date));
    return [...set].sort().reverse();
  }, [allTransactions]);

  const catName = (id: string | null) => {
    if (!id) return null;
    const c = categories.find((x) => x.id === id);
    if (!c) return null;
    if (c.parentId) {
      const p = categories.find((x) => x.id === c.parentId);
      return p ? `${p.name} › ${c.name}` : c.name;
    }
    return c.name;
  };

  // Despesas candidatas, ranqueadas: "aguardando reembolso" primeiro, depois
  // saldo que BATE com o que falta alocar (match exato em centavos), depois
  // cronológico. Busca por descrição/categoria e filtro de mês como antes.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tier = (t: Transaction) => {
      if (t.awaitingReimbursement) return 0;
      const cap = capCents(t);
      if (cap > 0 && remainingCents > 0 && cap === remainingCents) return 1;
      return 2;
    };
    return allTransactions
      .filter((t) => t.amount < 0 && t.id !== transaction.id)
      .filter((t) => !monthFilter || getMonthYear(t.date) === monthFilter)
      .filter((t) => {
        if (!q) return true;
        const cat = catName(t.categoryId)?.toLowerCase() || '';
        return t.description.toLowerCase().includes(q) || cat.includes(q);
      })
      .sort((a, b) => {
        const d = tier(a) - tier(b);
        if (d !== 0) return d;
        return b.date.getTime() - a.date.getTime();
      })
      .slice(0, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTransactions, search, monthFilter, transaction.id, categories, remainingCents, summary, savedByExpense]);

  const selectedIds = new Set(rows.map((r) => r.expenseId));

  function toggleCandidate(expense: Transaction) {
    if (selectedIds.has(expense.id)) {
      setRows((prev) => prev.filter((r) => r.expenseId !== expense.id));
      return;
    }
    const cap = capCents(expense);
    if (cap <= 0) return; // já totalmente reembolsada
    const prefill = Math.min(Math.max(remainingCents, 0), cap);
    setRows((prev) => [
      ...prev,
      { expenseId: expense.id, amountStr: applyMoneyMask((prefill / 100).toFixed(2)) },
    ]);
  }

  function setRowAmount(expenseId: string, raw: string) {
    setRows((prev) => prev.map((r) => (r.expenseId === expenseId ? { ...r, amountStr: applyMoneyMask(raw) } : r)));
  }

  /** No blur, clampa a fatia no teto da despesa (bloqueio, não aviso). */
  function clampRow(expenseId: string) {
    const expense = byId.get(expenseId);
    if (!expense) return;
    const cap = capCents(expense);
    setRows((prev) =>
      prev.map((r) => {
        if (r.expenseId !== expenseId) return r;
        const v = rowCents(r);
        if (v <= cap) return r;
        return { ...r, amountStr: applyMoneyMask((cap / 100).toFixed(2)) };
      })
    );
  }

  function removeRow(expenseId: string) {
    setRows((prev) => prev.filter((r) => r.expenseId !== expenseId));
  }

  function save() {
    if (blockReason) return;
    // Defensivo: mescla fatias duplicadas da mesma despesa antes de gravar.
    const merged = new Map<string, number>();
    for (const r of rows) {
      merged.set(r.expenseId, (merged.get(r.expenseId) ?? 0) + parseMoneyInput(r.amountStr));
    }
    onUpdate(transaction.id, {
      isReimbursement: true,
      reimbursementAllocations: [...merged.entries()].map(([expenseId, amount]) => ({ expenseId, amount })),
      reimbursementFor: null,
    });
    onClose();
  }

  function removeReimbursement() {
    // Volta ao estado original. Vínculo LEGADO sobrescrevia a categoria — se
    // houver a categoria guardada, restaura; alocações novas nunca mexeram nela.
    const restoreLegacyCategory = !!transaction.reimbursementFor && !!transaction.reimbursementPrevCategoryId;
    onUpdate(transaction.id, {
      isReimbursement: false,
      reimbursementAllocations: [],
      reimbursementFor: null,
      reimbursementPrevCategoryId: null,
      ...(restoreLegacyCategory ? { categoryId: transaction.reimbursementPrevCategoryId } : {}),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-bg-card border border-border rounded-lg w-full max-w-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <RefreshCcw size={15} className="text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Reembolso — abater quais despesas?</h3>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        {/* Cabeçalho: valor, quanto já foi distribuído e quanto falta */}
        <div className="px-4 py-3 border-b border-border space-y-1.5">
          <p className="text-[11px] text-text-secondary">
            Reembolso de <span className="font-semibold text-accent">{formatBRL(transaction.amount)}</span>
            {' '}({transaction.description}, {formatDate(transaction.date)}). Cada fatia abate a despesa
            escolhida e é contabilizada no <span className="font-semibold text-text-primary">mês da despesa</span>.
          </p>
          <p className="text-[11px] tabular-nums">
            <span className="text-text-secondary">Alocado: </span>
            <span className="font-semibold text-text-primary">{formatBRL(totalRowsCents / 100)}</span>
            <span className="text-text-secondary"> · Falta alocar: </span>
            <span className={`font-semibold ${remainingCents > 0 ? 'text-amber-400' : 'text-accent-green'}`}>
              {formatBRL(Math.max(remainingCents, 0) / 100)}
            </span>
            {remainingCents > 0 && rows.length > 0 && (
              <span className="text-text-secondary"> (o que sobrar abate no próprio mês)</span>
            )}
          </p>
          {overTotal && (
            <p className="text-[11px] text-accent-red flex items-center gap-1">
              <AlertTriangle size={11} className="flex-shrink-0" /> {blockReason}
            </p>
          )}
        </div>

        {/* Fatias atuais */}
        {rows.length > 0 && (
          <div className="border-b border-border max-h-[30vh] overflow-y-auto">
            <div className="px-4 py-1 bg-bg-secondary text-[10px] uppercase tracking-wider text-text-secondary">
              Abatendo estas despesas
            </div>
            {rows.map((r, i) => {
              const expense = byId.get(r.expenseId);
              const err = rowErrors[i];
              return (
                <div key={r.expenseId} className="px-4 py-2 border-b border-border/20 last:border-b-0">
                  <div className="flex items-center gap-3">
                    {expense ? (
                      <>
                        <span className="text-text-secondary text-[10px] tabular-nums w-[62px] flex-shrink-0">
                          {formatDate(expense.date)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs text-text-primary truncate">{expense.description}</span>
                          <span className="block text-[10px] text-text-secondary truncate">
                            {getMonthLabel(getMonthYear(expense.date))} · {catName(expense.categoryId) || 'Sem categoria'}
                          </span>
                        </span>
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-[10px] text-text-secondary">R$</span>
                          <input
                            value={r.amountStr}
                            onChange={(e) => setRowAmount(r.expenseId, e.target.value)}
                            onBlur={() => clampRow(r.expenseId)}
                            inputMode="decimal"
                            className={`w-[90px] px-2 py-1 bg-bg-secondary border rounded text-right text-xs tabular-nums text-text-primary focus:outline-none ${
                              err ? 'border-accent-red' : 'border-border focus:border-accent'
                            }`}
                          />
                          <span className="text-[10px] text-text-secondary tabular-nums whitespace-nowrap" title="Saldo disponível desta despesa">
                            de {formatBRL(capCents(expense) / 100)}
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="flex-1 text-xs text-accent-red">Despesa não encontrada (apagada).</span>
                    )}
                    <button
                      onClick={() => removeRow(r.expenseId)}
                      className="text-text-secondary hover:text-accent-red flex-shrink-0"
                      title="Remover esta fatia"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {err && !overTotal && <p className="text-[10px] text-accent-red mt-1 pl-[74px]">{err}</p>}
                </div>
              );
            })}
          </div>
        )}

        {/* Busca de candidatas */}
        <div className="p-3 border-b border-border flex gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar despesa por descrição ou categoria..."
              className="w-full pl-8 pr-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
            />
          </div>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="bg-bg-secondary border border-border rounded px-2 py-2 text-text-primary text-xs focus:outline-none focus:border-accent flex-shrink-0"
            title="Filtrar despesas por mês"
          >
            <option value="">Todos os meses</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>{getMonthLabel(m)}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {candidates.length === 0 ? (
            <div className="p-6 text-center text-text-secondary text-xs">Nenhuma despesa encontrada.</div>
          ) : (
            // Seções na ordem do ranking: aguardando → valor exato → por mês.
            (() => {
              const rowsOut: React.ReactNode[] = [];
              let lastKey = '';
              for (const t of candidates) {
                const cap = capCents(t);
                const others = othersCents(t.id);
                const isSelected = selectedIds.has(t.id);
                const exhausted = cap <= 0 && !isSelected;
                const key = t.awaitingReimbursement
                  ? '__await'
                  : cap > 0 && remainingCents > 0 && cap === remainingCents
                    ? '__match'
                    : getMonthYear(t.date);
                if (key !== lastKey) {
                  lastKey = key;
                  rowsOut.push(
                    <div
                      key={`h-${key}`}
                      className="sticky top-0 px-4 py-1 bg-bg-secondary text-[10px] uppercase tracking-wider text-text-secondary border-b border-border/40 z-10"
                    >
                      {key === '__await'
                        ? 'Aguardando reembolso'
                        : key === '__match'
                          ? 'Saldo bate com o que falta alocar'
                          : getMonthLabel(getMonthYear(t.date))}
                    </div>
                  );
                }
                rowsOut.push(
                  <button
                    key={t.id}
                    onClick={() => toggleCandidate(t)}
                    disabled={exhausted}
                    title={exhausted ? 'Despesa já totalmente reembolsada' : isSelected ? 'Clique para remover a fatia' : 'Clique para adicionar uma fatia'}
                    className={`w-full flex items-center gap-3 px-4 py-2 border-b border-border/20 text-left transition-colors ${
                      isSelected ? 'bg-accent/10' : exhausted ? 'opacity-40 cursor-not-allowed' : 'hover:bg-bg-secondary/40'
                    }`}
                  >
                    <span className="text-text-secondary text-[10px] tabular-nums w-[62px] flex-shrink-0">
                      {formatDate(t.date)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-text-primary truncate flex items-center gap-1.5">
                        {t.awaitingReimbursement && <Clock size={11} className="text-accent flex-shrink-0" />}
                        {t.description}
                        {isSelected && <span className="text-accent text-[10px] flex-shrink-0">✓ selecionada</span>}
                      </span>
                      <span className="block text-[10px] text-text-secondary truncate">
                        {catName(t.categoryId) || 'Sem categoria'}
                        {others > 0 && (
                          <span className={exhausted ? ' text-accent-green' : ' text-amber-400'}>
                            {' '}· {formatBRL(others / 100)} de {formatBRL(Math.abs(t.amount))} já abatido
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-right">
                      <span className="block text-accent-red font-bold text-xs tabular-nums">{formatBRL(t.amount)}</span>
                      {others > 0 && !exhausted && (
                        <span className="block text-[10px] text-text-secondary tabular-nums">
                          saldo {formatBRL(cap / 100)}
                        </span>
                      )}
                      {exhausted && <span className="block text-[10px] text-accent-green">já reembolsada</span>}
                    </span>
                  </button>
                );
              }
              return <Fragment>{rowsOut}</Fragment>;
            })()
          )}
        </div>

        {/* Rodapé: desfazer à esquerda; bloqueio explicado + salvar à direita */}
        <div className="p-3 border-t border-border flex items-center justify-between gap-2 flex-wrap">
          <span>
            {transaction.isReimbursement && (
              <button
                onClick={removeReimbursement}
                className="text-[11px] text-accent-red hover:text-accent-red/80"
              >
                Deixar de ser reembolso
              </button>
            )}
          </span>
          <span className="flex items-center gap-3">
            {blockReason && !overTotal && (
              <span className="text-[10px] text-accent-red max-w-[260px] text-right">{blockReason}</span>
            )}
            <button
              onClick={save}
              disabled={!!blockReason}
              className="px-3 py-1.5 bg-accent text-black rounded text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90"
              title={blockReason ?? undefined}
            >
              {rows.length > 0 ? 'Salvar alocações' : 'Marcar como reembolso (sem vincular)'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

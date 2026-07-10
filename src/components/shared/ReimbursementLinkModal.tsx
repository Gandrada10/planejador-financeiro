import { useState, useMemo, Fragment } from 'react';
import { X, Search, RefreshCcw, Clock } from 'lucide-react';
import type { Transaction, Category } from '../../types';
import { formatBRL, formatDate, getMonthLabel, getMonthYear } from '../../lib/utils';

interface Props {
  /** O reembolso sendo configurado (valor positivo). */
  transaction: Transaction;
  /** Todas as transações — para achar despesas candidatas de qualquer mês. */
  allTransactions: Transaction[];
  categories: Category[];
  onUpdate: (id: string, data: Partial<Transaction>) => void;
  onClose: () => void;
}

// Vincular um reembolso a uma despesa: define a categoria (a do gasto abatido)
// E ancora o abatimento no mês da despesa (Opção 1). Sem vínculo, o reembolso
// abate no próprio mês (comportamento simples). Ver `accountingDate`.
export function ReimbursementLinkModal({ transaction, allTransactions, categories, onUpdate, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('');

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

  const linked = transaction.reimbursementFor
    ? allTransactions.find((t) => t.id === transaction.reimbursementFor)
    : null;

  // Despesas candidatas: valores negativos, em ordem CRONOLÓGICA (mais
  // recentes primeiro) — só as marcadas como "aguardando reembolso" são
  // fixadas no topo, por serem alvos declarados. Busca por descrição/categoria.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTransactions
      .filter((t) => t.amount < 0 && t.id !== transaction.id)
      .filter((t) => !monthFilter || getMonthYear(t.date) === monthFilter)
      .filter((t) => {
        if (!q) return true;
        const cat = catName(t.categoryId)?.toLowerCase() || '';
        return t.description.toLowerCase().includes(q) || cat.includes(q);
      })
      .sort((a, b) => {
        if (!!b.awaitingReimbursement !== !!a.awaitingReimbursement) {
          return a.awaitingReimbursement ? -1 : 1;
        }
        return b.date.getTime() - a.date.getTime();
      })
      .slice(0, 300);
  }, [allTransactions, search, monthFilter, transaction.id, categories]);

  function linkTo(expense: Transaction) {
    // Copia a categoria da despesa para o reembolso abater a categoria certa,
    // guardando a categoria original (só na 1ª vez) para poder restaurar depois.
    const prev = transaction.reimbursementFor
      ? transaction.reimbursementPrevCategoryId ?? null
      : transaction.categoryId;
    onUpdate(transaction.id, {
      isReimbursement: true,
      reimbursementFor: expense.id,
      reimbursementPrevCategoryId: prev,
      categoryId: expense.categoryId,
    });
    onClose();
  }

  function markWithoutLink() {
    onUpdate(transaction.id, { isReimbursement: true, reimbursementFor: null });
    onClose();
  }

  function removeReimbursement() {
    // Volta ao estado original: se era vinculado (categoria sobrescrita pela da
    // despesa), restaura a categoria de antes. Sem vínculo, não mexe na categoria.
    const wasLinked = !!transaction.reimbursementFor;
    onUpdate(transaction.id, {
      isReimbursement: false,
      reimbursementFor: null,
      reimbursementPrevCategoryId: null,
      ...(wasLinked ? { categoryId: transaction.reimbursementPrevCategoryId ?? null } : {}),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-bg-card border border-border rounded-lg w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <RefreshCcw size={15} className="text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Reembolso — abater qual despesa?</h3>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border space-y-1">
          <p className="text-[11px] text-text-secondary">
            Vinculando <span className="font-semibold text-accent-green">{formatBRL(transaction.amount)}</span>
            {' '}({transaction.description}, {formatDate(transaction.date)}) — ele abaterá o gasto e será
            contabilizado no <span className="font-semibold text-text-primary">mês da despesa</span> escolhida.
          </p>
          {linked && (
            <p className="text-[11px] text-accent flex items-center gap-1">
              <RefreshCcw size={11} /> Vinculado a: {linked.description} · {getMonthLabel(getMonthYear(linked.date))}
            </p>
          )}
        </div>

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
            // Agrupa por mês (separadores) para deixar claro que dá para
            // vincular a despesas de QUALQUER mês, não só o atual. As marcadas
            // como "aguardando reembolso" ficam numa seção no topo.
            (() => {
              const rows: React.ReactNode[] = [];
              let lastKey = '';
              for (const t of candidates) {
                const key = t.awaitingReimbursement ? '__await' : getMonthYear(t.date);
                if (key !== lastKey) {
                  lastKey = key;
                  rows.push(
                    <div
                      key={`h-${key}`}
                      className="sticky top-0 px-4 py-1 bg-bg-secondary text-[10px] uppercase tracking-wider text-text-secondary border-b border-border/40 z-10"
                    >
                      {key === '__await' ? 'Aguardando reembolso' : getMonthLabel(getMonthYear(t.date))}
                    </div>
                  );
                }
                const isLinked = transaction.reimbursementFor === t.id;
                rows.push(
                  <button
                    key={t.id}
                    onClick={() => linkTo(t)}
                    className={`w-full flex items-center gap-3 px-4 py-2 border-b border-border/20 text-left hover:bg-bg-secondary/40 transition-colors ${
                      isLinked ? 'bg-accent/10' : ''
                    }`}
                  >
                    <span className="text-text-secondary text-[10px] tabular-nums w-[62px] flex-shrink-0">
                      {formatDate(t.date)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-text-primary truncate flex items-center gap-1.5">
                        {t.awaitingReimbursement && <Clock size={11} className="text-accent flex-shrink-0" />}
                        {t.description}
                      </span>
                      <span className="block text-[10px] text-text-secondary truncate">
                        {catName(t.categoryId) || 'Sem categoria'}
                      </span>
                    </span>
                    <span className="text-accent-red font-bold text-xs tabular-nums flex-shrink-0">
                      {formatBRL(t.amount)}
                    </span>
                  </button>
                );
              }
              return <Fragment>{rows}</Fragment>;
            })()
          )}
        </div>

        <div className="p-3 border-t border-border flex items-center justify-between gap-2 flex-wrap">
          <button
            onClick={markWithoutLink}
            className="text-[11px] text-text-secondary hover:text-text-primary underline decoration-dotted"
            title="Marca como reembolso, mas abate no próprio mês (sem ancorar)"
          >
            Marcar sem vincular
          </button>
          {transaction.isReimbursement && (
            <button
              onClick={removeReimbursement}
              className="text-[11px] text-accent-red hover:text-accent-red/80"
            >
              Deixar de ser reembolso
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

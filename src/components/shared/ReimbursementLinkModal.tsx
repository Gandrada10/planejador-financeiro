import { useState, useMemo } from 'react';
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

  // Despesas candidatas: valores negativos, ordenadas por (1) marcadas como
  // "aguardando reembolso", (2) proximidade do valor do reembolso, (3) mais
  // recentes. Busca filtra por descrição/categoria.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const target = Math.abs(transaction.amount);
    return allTransactions
      .filter((t) => t.amount < 0 && t.id !== transaction.id)
      .filter((t) => {
        if (!q) return true;
        const cat = catName(t.categoryId)?.toLowerCase() || '';
        return t.description.toLowerCase().includes(q) || cat.includes(q);
      })
      .sort((a, b) => {
        if (!!b.awaitingReimbursement !== !!a.awaitingReimbursement) {
          return a.awaitingReimbursement ? -1 : 1;
        }
        const da = Math.abs(Math.abs(a.amount) - target);
        const db = Math.abs(Math.abs(b.amount) - target);
        if (Math.abs(da - db) > 0.005) return da - db;
        return b.date.getTime() - a.date.getTime();
      })
      .slice(0, 40);
  }, [allTransactions, search, transaction.amount, transaction.id, categories]);

  function linkTo(expense: Transaction) {
    // Copia a categoria da despesa para o reembolso abater a categoria certa.
    onUpdate(transaction.id, {
      isReimbursement: true,
      reimbursementFor: expense.id,
      categoryId: expense.categoryId,
    });
    onClose();
  }

  function markWithoutLink() {
    onUpdate(transaction.id, { isReimbursement: true, reimbursementFor: null });
    onClose();
  }

  function removeReimbursement() {
    onUpdate(transaction.id, { isReimbursement: false, reimbursementFor: null });
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

        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar despesa por descrição ou categoria..."
              className="w-full pl-8 pr-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {candidates.length === 0 ? (
            <div className="p-6 text-center text-text-secondary text-xs">Nenhuma despesa encontrada.</div>
          ) : (
            candidates.map((t) => {
              const isLinked = transaction.reimbursementFor === t.id;
              return (
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
            })
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

import { useState, useRef, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Search, X } from 'lucide-react';
import type { Category, CategorizationTransaction } from '../../types';
import { formatBRL, formatDate } from '../../lib/utils';

interface Props {
  transaction: CategorizationTransaction;
  categories: Category[];
  onCategorize: (categoryId: string, notes: string) => Promise<void>;
  onSkip: () => void;
  onBack?: () => void;
  remaining: number;
}

function removeAccents(str: string) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function CategorizationCard({ transaction, categories, onCategorize, onSkip, onBack, remaining }: Props) {
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'despesa' || c.type === 'ambos'),
    [categories]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return expenseCategories;
    const term = removeAccents(search.toLowerCase());
    return expenseCategories.filter((c) =>
      removeAccents(c.name.toLowerCase()).includes(term)
    );
  }, [search, expenseCategories]);

  // Reset state when transaction changes
  useEffect(() => {
    setSearch('');
    setShowNotes(false);
    setNotes('');
  }, [transaction.id]);

  async function handleSelect(categoryId: string) {
    setSaving(true);
    await onCategorize(categoryId, notes);
    setNotes('');
    setShowNotes(false);
    setSearch('');
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Transaction info — compact */}
      <div className="bg-bg-card border border-border rounded-xl p-4 text-center space-y-1">
        <p className="text-text-primary text-sm font-bold leading-tight truncate">
          {transaction.description}
        </p>
        <p className="text-accent-red text-xl font-bold font-mono">
          {formatBRL(transaction.amount)}
        </p>
        <div className="flex items-center justify-center gap-2 text-text-secondary text-[11px]">
          <span>{formatDate(transaction.date)}</span>
          {transaction.totalInstallments && (
            <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded font-mono text-[10px]">
              {transaction.installmentNumber}/{transaction.totalInstallments}
            </span>
          )}
          <span className="text-text-secondary/50">•</span>
          <span>{remaining} restante{remaining !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Search + Categories */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        {/* Search bar */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar categoria..."
              // font-size 16px prevents iOS auto-zoom
              className="w-full pl-8 pr-8 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary text-[16px] focus:outline-none focus:border-accent placeholder:text-text-secondary/50"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); searchRef.current?.focus(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Category chips — scrollable */}
        <div className="p-3 max-h-[45vh] overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <p className="text-text-secondary text-xs text-center py-4">
              Nenhuma categoria encontrada
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {filtered.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleSelect(cat.id)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border rounded-full hover:border-accent hover:bg-accent/5 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
                >
                  <span className="text-sm leading-none">{cat.icon}</span>
                  <span className="text-xs text-text-primary leading-none">{cat.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notes + Navigation */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        {/* Notes toggle */}
        <div className="px-4 py-2.5">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-colors"
          >
            <MessageSquare size={13} />
            {showNotes ? 'Esconder observacao' : 'Adicionar observacao'}
          </button>
          {showNotes && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: presente de aniversario da Mae..."
              // font-size 16px prevents iOS auto-zoom on focus
              className="w-full mt-2 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary text-[16px] focus:outline-none focus:border-accent resize-none"
              rows={2}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex border-t border-border">
          <button
            onClick={onBack}
            disabled={!onBack}
            className="flex-1 flex items-center justify-center gap-1 py-3 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-secondary/50 transition-colors disabled:opacity-30 active:bg-bg-secondary/70"
          >
            <ChevronLeft size={14} /> Voltar
          </button>
          <div className="w-px bg-border" />
          <button
            onClick={onSkip}
            className="flex-1 flex items-center justify-center gap-1 py-3 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-secondary/50 transition-colors active:bg-bg-secondary/70"
          >
            Pular <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
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

export function CategorizationCard({ transaction, categories, onCategorize, onSkip, onBack, remaining }: Props) {
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSelect(categoryId: string) {
    setSaving(true);
    await onCategorize(categoryId, notes);
    setNotes('');
    setShowNotes(false);
    setSaving(false);
  }

  const expenseCategories = categories.filter((c) => c.type === 'despesa' || c.type === 'ambos');

  return (
    <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
      {/* Transaction info */}
      <div className="p-5 border-b border-border text-center space-y-2">
        <p className="text-text-primary text-sm font-bold leading-tight">
          {transaction.description}
        </p>
        <p className="text-accent-red text-2xl font-bold font-mono">
          {formatBRL(transaction.amount)}
        </p>
        <div className="flex items-center justify-center gap-3 text-text-secondary text-[11px]">
          <span>{formatDate(transaction.date)}</span>
          {transaction.totalInstallments && (
            <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded font-mono text-[10px]">
              {transaction.installmentNumber}/{transaction.totalInstallments}
            </span>
          )}
        </div>
        <p className="text-text-secondary text-[10px]">
          {remaining} restante{remaining !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Category grid */}
      <div className="p-4">
        <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-3 text-center">
          Selecione a categoria
        </p>
        <div className="grid grid-cols-3 gap-2">
          {expenseCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleSelect(cat.id)}
              disabled={saving}
              className="flex flex-col items-center gap-1 p-3 bg-bg-secondary border border-border rounded-lg hover:border-accent hover:bg-accent/5 transition-all active:scale-95 disabled:opacity-50"
            >
              <span className="text-xl">{cat.icon}</span>
              <span className="text-[10px] text-text-primary leading-tight text-center">
                {cat.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Notes toggle */}
      <div className="px-4 pb-2">
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="flex items-center gap-1.5 text-[10px] text-text-secondary hover:text-accent transition-colors"
        >
          <MessageSquare size={12} />
          {showNotes ? 'Esconder observacao' : 'Adicionar observacao'}
        </button>
        {showNotes && (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: presente de aniversario da Mae..."
            className="w-full mt-2 px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent resize-none"
            rows={2}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex border-t border-border">
        <button
          onClick={onBack}
          disabled={!onBack}
          className="flex-1 flex items-center justify-center gap-1 py-3 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-secondary/50 transition-colors disabled:opacity-30"
        >
          <ChevronLeft size={14} /> Voltar
        </button>
        <div className="w-px bg-border" />
        <button
          onClick={onSkip}
          className="flex-1 flex items-center justify-center gap-1 py-3 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-secondary/50 transition-colors"
        >
          Pular <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

import { useState, useRef, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Search, X } from 'lucide-react';
import type { Category, CategorizationTransaction } from '../../types';
import { formatBRL, formatDate } from '../../lib/utils';
import { CategoryIcon } from '../shared/CategoryIcon';

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

// Silver color for secondary text on this page (brighter than the global #737373)
const silver = 'text-[#a8a8a8]';
const silverPlaceholder = 'placeholder:text-[#a8a8a8]/50';

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

  // Group by parent/child hierarchy
  const groupedCategories = useMemo(() => {
    const roots = expenseCategories.filter((c) => !c.parentId);
    const children = expenseCategories.filter((c) => c.parentId);

    const groups: { parent: Category; subs: Category[] }[] = [];
    const standalone: Category[] = [];

    for (const root of roots) {
      const subs = children.filter((c) => c.parentId === root.id);
      if (subs.length > 0) {
        groups.push({ parent: root, subs });
      } else {
        standalone.push(root);
      }
    }

    const groupedChildIds = new Set(groups.flatMap((g) => g.subs.map((s) => s.id)));
    const orphans = children.filter((c) => !groupedChildIds.has(c.id));
    standalone.push(...orphans);

    return { groups, standalone };
  }, [expenseCategories]);

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groupedCategories;
    const term = removeAccents(search.toLowerCase());
    const match = (c: Category) => removeAccents(c.name.toLowerCase()).includes(term);

    const groups = groupedCategories.groups
      .map((g) => {
        const parentMatch = match(g.parent);
        const filteredSubs = g.subs.filter(match);
        if (parentMatch) return g;
        if (filteredSubs.length > 0) return { parent: g.parent, subs: filteredSubs };
        return null;
      })
      .filter(Boolean) as { parent: Category; subs: Category[] }[];

    const standalone = groupedCategories.standalone.filter(match);
    return { groups, standalone };
  }, [search, groupedCategories]);

  const hasResults = filteredGroups.groups.length > 0 || filteredGroups.standalone.length > 0;

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

  function CategoryButton({ cat, indent }: { cat: Category; indent?: boolean }) {
    return (
      <button
        onClick={() => handleSelect(cat.id)}
        disabled={saving}
        className={`w-full flex items-center gap-3 px-4 py-3.5 bg-bg-secondary border border-border rounded-xl hover:border-accent hover:bg-accent/5 active:scale-[0.98] transition-all disabled:opacity-50 ${indent ? 'ml-6' : ''}`}
      >
        <CategoryIcon icon={cat.icon} size={18} className="text-text-primary flex-shrink-0" />
        <span className="text-sm text-text-primary text-left">{cat.name}</span>
      </button>
    );
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
        <div className={`flex items-center justify-center gap-2 ${silver} text-xs`}>
          <span>{formatDate(transaction.date)}</span>
          {transaction.totalInstallments && (
            <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded font-mono text-[10px]">
              {transaction.installmentNumber}/{transaction.totalInstallments}
            </span>
          )}
          <span className="opacity-40">•</span>
          <span>{remaining} restante{remaining !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Search + Categories */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        {/* Search bar */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${silver} pointer-events-none`} />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar categoria..."
              className={`w-full pl-8 pr-8 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary text-[16px] focus:outline-none focus:border-accent ${silverPlaceholder}`}
            />
            {search && (
              <button
                onClick={() => { setSearch(''); searchRef.current?.focus(); }}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${silver} hover:text-text-primary`}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Category list — vertical, grouped, no horizontal scroll */}
        <div className="p-3 max-h-[50vh] overflow-y-auto overflow-x-hidden overscroll-contain">
          {!hasResults ? (
            <p className={`${silver} text-xs text-center py-4`}>
              Nenhuma categoria encontrada
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Grouped categories (parent + subs) */}
              {filteredGroups.groups.map((group) => (
                <div key={group.parent.id} className="flex flex-col gap-1.5">
                  {/* Parent label */}
                  <div className={`flex items-center gap-2 px-2 pt-2 pb-1 ${silver} text-[11px] uppercase tracking-wider font-bold`}>
                    <CategoryIcon icon={group.parent.icon} size={14} className={silver} />
                    <span className="truncate">{group.parent.name}</span>
                  </div>
                  {/* Subcategories */}
                  {group.subs.map((sub) => (
                    <CategoryButton key={sub.id} cat={sub} indent />
                  ))}
                </div>
              ))}

              {/* Standalone categories (no children) */}
              {filteredGroups.standalone.length > 0 && filteredGroups.groups.length > 0 && (
                <div className={`px-2 pt-3 pb-1 ${silver} text-[11px] uppercase tracking-wider font-bold`}>
                  Outras
                </div>
              )}
              {filteredGroups.standalone.map((cat) => (
                <CategoryButton key={cat.id} cat={cat} />
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
            className={`flex items-center gap-1.5 text-xs ${silver} hover:text-accent transition-colors`}
          >
            <MessageSquare size={13} />
            {showNotes ? 'Esconder observacao' : 'Adicionar observacao'}
          </button>
          {showNotes && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: presente de aniversario da Mae..."
              className={`w-full mt-2 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary text-[16px] focus:outline-none focus:border-accent resize-none ${silverPlaceholder}`}
              rows={2}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex border-t border-border">
          <button
            onClick={onBack}
            disabled={!onBack}
            className={`flex-1 flex items-center justify-center gap-1 py-3 text-xs ${silver} hover:text-text-primary hover:bg-bg-secondary/50 transition-colors disabled:opacity-30 active:bg-bg-secondary/70`}
          >
            <ChevronLeft size={14} /> Voltar
          </button>
          <div className="w-px bg-border" />
          <button
            onClick={onSkip}
            className="flex-1 flex items-center justify-center gap-1 py-3.5 text-sm font-bold text-accent border-l-0 hover:bg-accent/10 transition-colors active:bg-accent/20"
          >
            Pular <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, Search, X } from 'lucide-react';
import type { Category, CategorizationTransaction } from '../../types';
import { formatBRL, formatDate, filterCategoriesByAmount } from '../../lib/utils';
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
  const [exiting, setExiting] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const highlightedRef = useRef<HTMLButtonElement>(null);

  const expenseCategories = useMemo(
    () => filterCategoriesByAmount(categories, transaction.amount),
    [categories, transaction.amount]
  );

  // Group by parent/child hierarchy
  const groupedCategories = useMemo(() => {
    const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
    const roots = expenseCategories.filter((c) => !c.parentId).sort((a, b) => collator.compare(a.name, b.name));
    const children = expenseCategories.filter((c) => c.parentId);

    const groups: { parent: Category; subs: Category[] }[] = [];
    const standalone: Category[] = [];

    for (const root of roots) {
      const subs = children.filter((c) => c.parentId === root.id).sort((a, b) => collator.compare(a.name, b.name));
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

  // Flat list of selectable categories (subs from groups + standalone), in display order
  const flatCategories = useMemo(() => {
    const flat: Category[] = [];
    for (const group of filteredGroups.groups) {
      for (const sub of group.subs) flat.push(sub);
    }
    for (const cat of filteredGroups.standalone) flat.push(cat);
    return flat;
  }, [filteredGroups]);

  const hasResults = filteredGroups.groups.length > 0 || filteredGroups.standalone.length > 0;

  // Reset highlight to first item whenever search changes
  useEffect(() => {
    setHighlightedIndex(search.trim() ? 0 : -1);
  }, [search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  // Reset state when transaction changes
  useEffect(() => {
    setSearch('');
    setShowNotes(false);
    setNotes('');
    setHighlightedIndex(-1);
  }, [transaction.id]);

  const handleSelect = useCallback(async (categoryId: string) => {
    // Dismiss keyboard on iOS before animating
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setSaving(true);
    setExiting(true);
    // Wait for exit animation before processing
    await new Promise((r) => setTimeout(r, 250));
    await onCategorize(categoryId, notes);
    setNotes('');
    setShowNotes(false);
    setSearch('');
    setHighlightedIndex(-1);
    setExiting(false);
    setSaving(false);
  }, [onCategorize, notes]);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, flatCategories.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && flatCategories[highlightedIndex]) {
        handleSelect(flatCategories[highlightedIndex].id);
      } else if (flatCategories.length === 1) {
        // If only one result, Enter selects it even without highlight
        handleSelect(flatCategories[0].id);
      }
    } else if (e.key === 'Escape') {
      setSearch('');
      setHighlightedIndex(-1);
    }
  }

  function CategoryButton({ cat, indent, index, parentName }: { cat: Category; indent?: boolean; index: number; parentName?: string }) {
    const isHighlighted = index === highlightedIndex;
    return (
      <button
        ref={isHighlighted ? highlightedRef : undefined}
        onClick={() => handleSelect(cat.id)}
        disabled={saving}
        className={`w-full flex items-center gap-3 px-4 py-3 bg-bg-secondary border rounded-xl active:scale-[0.98] transition-all disabled:opacity-50 ${indent ? 'ml-6' : ''} ${
          isHighlighted
            ? 'border-accent bg-accent/10 text-text-primary'
            : 'border-border hover:border-accent hover:bg-accent/5'
        }`}
      >
        <CategoryIcon icon={cat.icon} size={18} className="text-text-primary flex-shrink-0" />
        <div className="flex flex-col text-left min-w-0">
          <span className="text-sm text-text-primary">{cat.name}</span>
          {parentName && (
            <span className={`text-[11px] ${silver} leading-tight`}>{parentName}</span>
          )}
        </div>
      </button>
    );
  }

  // Build indexed flat list tracker for rendering
  let flatIndex = 0;

  return (
    <div className={`flex flex-col gap-3 transition-all duration-200 ease-out ${exiting ? 'opacity-0 -translate-x-8 scale-[0.97]' : 'opacity-100 translate-x-0 scale-100'}`}>
      {/* Transaction info — compact */}
      <div className="bg-bg-card border border-border rounded-xl p-4 text-center space-y-1">
        <p className="text-white text-base font-bold leading-tight truncate">
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
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar categoria... (↑↓ navegar, Enter selecionar)"
              className={`w-full pl-8 pr-8 py-2.5 bg-bg-secondary border border-border rounded-lg text-text-primary text-[16px] focus:outline-none focus:border-accent ${silverPlaceholder}`}
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setHighlightedIndex(-1); searchRef.current?.focus(); }}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${silver} hover:text-text-primary`}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Category list — vertical, grouped, no horizontal scroll */}
        <div ref={listRef} className="p-3 max-h-[50vh] overflow-y-auto overflow-x-hidden overscroll-contain">
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
                  {group.subs.map((sub) => {
                    const idx = flatIndex++;
                    return <CategoryButton key={sub.id} cat={sub} indent index={idx} parentName={search.trim() ? group.parent.name : undefined} />;
                  })}
                </div>
              ))}

              {/* Standalone categories (no children) */}
              {filteredGroups.standalone.length > 0 && filteredGroups.groups.length > 0 && (
                <div className={`px-2 pt-3 pb-1 ${silver} text-[11px] uppercase tracking-wider font-bold`}>
                  Outras
                </div>
              )}
              {filteredGroups.standalone.map((cat) => {
                const idx = flatIndex++;
                return <CategoryButton key={cat.id} cat={cat} index={idx} />;
              })}
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

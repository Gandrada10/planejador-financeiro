import { useState, useRef, useEffect, useMemo } from 'react';
import type { Category } from '../../types';
import { filterCategoriesByAmount, tabNavigate } from '../../lib/utils';

function removeAccents(str: string) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

interface Props {
  categories: Category[];
  amount: number;
  value: string | null;
  onChange: (categoryId: string | null) => void;
  /** CSS class for the wrapper */
  className?: string;
  /** Text size class */
  textSize?: string;
  /** Compact mode (less padding) */
  compact?: boolean;
}

export function CategoryCombobox({ categories, amount, value, onChange, className = '', textSize = 'text-xs', compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const relevantCats = useMemo(() => filterCategoriesByAmount(categories, amount), [categories, amount]);
  const rootCats = useMemo(() => relevantCats.filter((c) => !c.parentId), [relevantCats]);

  const allOptions = useMemo(() => {
    const opts: { id: string; label: string; searchLabel: string; color: string; isChild: boolean }[] = [];
    for (const cat of rootCats) {
      const subs = relevantCats.filter((c) => c.parentId === cat.id);
      if (subs.length > 0) {
        opts.push({ id: cat.id, label: cat.name, searchLabel: cat.name, color: cat.color, isChild: false });
        for (const sub of subs) {
          opts.push({ id: sub.id, label: `↳ ${sub.name}`, searchLabel: `${cat.name} ${sub.name}`, color: sub.color, isChild: true });
        }
      } else {
        opts.push({ id: cat.id, label: cat.name, searchLabel: cat.name, color: cat.color, isChild: false });
      }
    }
    return opts;
  }, [rootCats, relevantCats]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allOptions;
    const term = removeAccents(search.toLowerCase());
    return allOptions.filter((o) => removeAccents(o.searchLabel.toLowerCase()).includes(term));
  }, [allOptions, search]);

  const currentCat = categories.find((c) => c.id === value);
  const currentLabel = currentCat ? currentCat.name : '';
  const currentColor = currentCat?.color || 'var(--color-text-secondary)';

  useEffect(() => {
    setHighlighted(search.trim() ? 0 : -1);
  }, [search]);

  useEffect(() => {
    if (highlighted >= 0 && listRef.current) {
      const el = listRef.current.children[highlighted] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function openDropdown() {
    setOpen(true);
    setSearch('');
    setHighlighted(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function doNavigate(direction: 'next' | 'prev') {
    if (containerRef.current) {
      setTimeout(() => tabNavigate(containerRef.current!, direction), 50);
    }
  }

  function select(id: string | null, autoAdvance = false) {
    onChange(id);
    setOpen(false);
    setSearch('');
    if (autoAdvance) doNavigate('next');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      setOpen(false);
      setSearch('');
      doNavigate(e.shiftKey ? 'prev' : 'next');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && filtered[highlighted]) {
        select(filtered[highlighted].id, true);
      } else if (filtered.length === 1) {
        select(filtered[0].id, true);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  }

  const py = compact ? 'py-0' : 'py-0.5';

  return (
    <div ref={containerRef} className={`relative ${className}`} data-tab-cell data-category-combobox>
      <button
        data-category-trigger
        onClick={openDropdown}
        className={`w-full text-left bg-transparent border-none ${textSize} cursor-pointer focus:outline-none hover:text-text-primary rounded px-1 ${py} truncate`}
        style={{ color: currentColor }}
      >
        {currentLabel || <span className="text-text-secondary">Sem categoria</span>}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-56 bg-[#1a1a1a] border border-border rounded-lg shadow-xl overflow-hidden" style={{ left: 0 }}>
          <div className="p-1.5 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digitar categoria..."
              className="w-full bg-bg-secondary border border-border rounded px-2 py-1.5 text-text-primary text-xs focus:outline-none focus:border-accent placeholder:text-text-secondary/50"
            />
          </div>
          <div ref={listRef} className="max-h-48 overflow-y-auto">
            <button
              onClick={() => select(null)}
              className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-text-primary transition-colors"
            >
              Sem categoria
            </button>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-secondary text-center">Nenhuma encontrada</div>
            ) : (
              filtered.map((opt, i) => (
                <button
                  key={opt.id}
                  onClick={() => select(opt.id)}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    i === highlighted
                      ? 'bg-accent/20 text-text-primary'
                      : 'text-text-secondary hover:bg-accent/10 hover:text-text-primary'
                  } ${opt.isChild ? 'pl-5' : ''}`}
                  style={{ color: i === highlighted ? undefined : opt.color }}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

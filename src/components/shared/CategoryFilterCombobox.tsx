import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Category } from '../../types';
import { cn } from '../../lib/utils';

/**
 * Seletor de categoria para FILTRAR a lista de transações — espelha o visual do
 * CategoryCombobox (usado ao ATRIBUIR categoria na coluna): cores por categoria,
 * hierarquia pai → subcategoria (com `↳`) e busca por digitação. Diferente do
 * combobox de atribuição, aqui:
 *  - o valor tem TRÊS estados: 'all' (todas), 'uncategorized' (sem categoria) ou
 *    um id de categoria;
 *  - mostra TODAS as categorias (receita e despesa), sem filtrar por sinal.
 * A regra de rollup (pai inclui subcategorias) fica no filtro da página, que já
 * expande a categoria-pai para os ids das filhas.
 */

function removeAccents(str: string) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

interface Props {
  categories: Category[];
  /** 'all' | 'uncategorized' | categoryId */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function CategoryFilterCombobox({ categories, value, onChange, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rootCats = useMemo(() => categories.filter((c) => !c.parentId), [categories]);

  // Lista achatada: raiz e, logo abaixo, suas subcategorias (indentadas). Órfãs
  // (cujo pai sumiu) entram no fim como raízes, para nunca desaparecerem.
  const allOptions = useMemo(() => {
    const opts: { id: string; label: string; parentLabel: string; searchLabel: string; color: string; isChild: boolean }[] = [];
    const seen = new Set<string>();
    for (const cat of rootCats) {
      opts.push({ id: cat.id, label: cat.name, parentLabel: '', searchLabel: cat.name, color: cat.color, isChild: false });
      seen.add(cat.id);
      for (const sub of categories.filter((c) => c.parentId === cat.id)) {
        opts.push({ id: sub.id, label: sub.name, parentLabel: cat.name, searchLabel: `${cat.name} ${sub.name}`, color: sub.color, isChild: true });
        seen.add(sub.id);
      }
    }
    for (const cat of categories) {
      if (!seen.has(cat.id)) {
        opts.push({ id: cat.id, label: cat.name, parentLabel: '', searchLabel: cat.name, color: cat.color, isChild: false });
        seen.add(cat.id);
      }
    }
    return opts;
  }, [rootCats, categories]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allOptions;
    const term = removeAccents(search.toLowerCase());
    return allOptions.filter((o) => removeAccents(o.searchLabel.toLowerCase()).includes(term));
  }, [allOptions, search]);

  const currentCat = value !== 'all' && value !== 'uncategorized' ? categories.find((c) => c.id === value) : null;
  const currentParent = currentCat?.parentId ? categories.find((c) => c.id === currentCat.parentId) : null;
  const currentLabel =
    value === 'uncategorized'
      ? 'Sem categoria'
      : currentCat
        ? currentParent
          ? `${currentParent.name} / ${currentCat.name}`
          : currentCat.name
        : 'Todas as categorias';
  const active = value !== 'all';

  useEffect(() => {
    if (highlighted >= 0 && listRef.current) {
      const el = listRef.current.children[highlighted] as HTMLElement | undefined;
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

  function select(v: string) {
    onChange(v);
    setOpen(false);
    setSearch('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && filtered[highlighted]) select(filtered[highlighted].id);
      else if (filtered.length === 1) select(filtered[0].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={openDropdown}
        title={currentLabel}
        className={cn(
          'w-full flex items-center justify-between gap-1.5 px-3 py-2 bg-bg-secondary border rounded text-xs focus:outline-none transition-colors',
          active ? 'border-accent bg-accent/10' : 'border-border'
        )}
      >
        <span
          className={cn('truncate', !currentCat && (value === 'uncategorized' ? 'text-accent' : 'text-text-primary'))}
          style={currentCat ? { color: currentCat.color } : undefined}
        >
          {currentLabel}
        </span>
        <ChevronDown size={14} className="flex-shrink-0 text-text-secondary" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 min-w-full w-max max-w-[calc(100vw-2rem)] sm:max-w-[22rem] bg-[#1a1a1a] border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="p-1.5 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => {
                const v = e.target.value;
                setSearch(v);
                setHighlighted(v.trim() ? 0 : -1);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Digitar categoria..."
              className="w-full bg-bg-secondary border border-border rounded px-2 py-1.5 text-text-primary text-xs focus:outline-none focus:border-accent placeholder:text-text-secondary/50"
            />
          </div>

          {!search.trim() && (
            <div className="border-b border-border">
              <button
                onClick={() => select('all')}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-accent/10 hover:text-text-primary',
                  value === 'all' ? 'text-accent font-semibold' : 'text-text-secondary'
                )}
              >
                Todas as categorias
              </button>
              <button
                onClick={() => select('uncategorized')}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-accent/10 hover:text-text-primary',
                  value === 'uncategorized' ? 'text-accent font-semibold' : 'text-text-secondary'
                )}
              >
                Sem categoria
              </button>
            </div>
          )}

          <div ref={listRef} className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-secondary text-center">Nenhuma encontrada</div>
            ) : (
              filtered.map((opt, i) => (
                <button
                  key={opt.id}
                  onClick={() => select(opt.id)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-1',
                    i === highlighted ? 'bg-accent/20 text-text-primary' : 'hover:bg-accent/10 hover:text-text-primary',
                    opt.isChild && 'pl-5',
                    value === opt.id && 'bg-accent/10'
                  )}
                  style={{ color: i === highlighted ? undefined : opt.color }}
                >
                  <span className="truncate">{opt.isChild ? `↳ ${opt.label}` : opt.label}</span>
                  {opt.isChild && opt.parentLabel && (
                    <span className="flex-shrink-0 text-[10px] text-text-secondary/60 italic">{opt.parentLabel}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

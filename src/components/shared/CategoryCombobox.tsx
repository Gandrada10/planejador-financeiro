import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Category } from '../../types';
import { filterCategoriesByAmount, tabNavigate } from '../../lib/utils';
import { useAnchoredPosition } from './useAnchoredPosition';

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

export function CategoryCombobox({ categories, amount, value, onChange, className = '', textSize = 'text-body', compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const relevantCats = useMemo(() => filterCategoriesByAmount(categories, amount), [categories, amount]);
  const rootCats = useMemo(() => relevantCats.filter((c) => !c.parentId), [relevantCats]);

  const allOptions = useMemo(() => {
    const opts: { id: string; label: string; parentLabel: string; searchLabel: string; color: string; isChild: boolean }[] = [];
    for (const cat of rootCats) {
      const subs = relevantCats.filter((c) => c.parentId === cat.id);
      if (subs.length > 0) {
        opts.push({ id: cat.id, label: cat.name, parentLabel: '', searchLabel: cat.name, color: cat.color, isChild: false });
        for (const sub of subs) {
          opts.push({ id: sub.id, label: sub.name, parentLabel: cat.name, searchLabel: `${cat.name} ${sub.name}`, color: sub.color, isChild: true });
        }
      } else {
        opts.push({ id: cat.id, label: cat.name, parentLabel: '', searchLabel: cat.name, color: cat.color, isChild: false });
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
  const currentParent = currentCat?.parentId ? categories.find((c) => c.id === currentCat.parentId) : null;
  const currentLabel = currentCat
    ? currentParent ? `${currentParent.name}/${currentCat.name}` : currentCat.name
    : '';
  const currentColor = currentCat?.color || 'var(--color-text-secondary)';

  useEffect(() => {
    setHighlighted(search.trim() ? 0 : -1);
  }, [search]);

  useEffect(() => {
    if (highlighted >= 0 && listRef.current) {
      // children[0] is the "Sem categoria" button, filtered items start at index 1
      const el = listRef.current.children[highlighted + 1] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  // A lista vai para um PORTAL (ver render), então "clicou fora" tem de
  // considerar os dois pedaços: o gatilho e o pop-up.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
      setSearch('');
    }
    // Rolar a tabela atrás desancora o pop-up (é `fixed`): fecha. Rolar DENTRO
    // dele, não — inclusive a rolagem que as setas do teclado provocam na
    // lista, que senão fecharia o dropdown a cada tecla.
    function handleScroll(e: Event) {
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setSearch('');
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  useAnchoredPosition({
    open,
    anchorRef: containerRef,
    popRef,
    minWidth: 288, // 18rem — piso que o dropdown já tinha
    maxWidth: 352, // 22rem
  });

  function openDropdown() {
    setOpen(true);
    setSearch('');
    setHighlighted(-1);
    // preventScroll: focar um campo `fixed` fora da tela faria o navegador
    // rolar a página inteira atrás dele.
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
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
        tabIndex={-1}
        data-category-trigger
        onClick={openDropdown}
        title={currentLabel || 'Sem categoria'}
        className={`w-full text-left bg-transparent border-none ${textSize} cursor-pointer focus:outline-none hover:text-text-primary rounded-control px-1 ${py} truncate`}
        style={{ color: currentColor }}
      >
        {currentLabel || <span className="text-text-secondary">Sem categoria</span>}
      </button>

      {/* Em PORTAL: dentro da célula, `absolute` era recortado pela caixa de
          rolagem da tabela — na última linha aparecia uma opção e meia. Em
          portal + fixed, o dropdown sobe quando não há espaço embaixo. */}
      {open && createPortal(
        <div
          ref={popRef}
          // top/left/width/max-height vêm de useAnchoredPosition, antes da
          // pintura — por isso não estão aqui.
          style={{ position: 'fixed', zIndex: 9999 }}
          className="flex flex-col bg-elevated border border-border rounded-card shadow-2xl overflow-hidden"
        >
          <div className="p-1.5 border-b border-border flex-shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digitar categoria..."
              className="w-full bg-bg-secondary border border-border rounded-control px-2 py-1.5 text-text-primary text-body focus:outline-none focus:border-accent placeholder:text-text-secondary/50"
            />
          </div>
          {/* min-h-0: sem isso o filho flex não encolhe e a lista vaza do teto
              de altura em vez de rolar por dentro. */}
          <div ref={listRef} className="max-h-48 min-h-0 flex-1 overflow-y-auto">
            <button
              onClick={() => select(null)}
              className="w-full text-left px-3 py-1.5 text-body text-text-secondary hover:bg-accent/10 hover:text-text-primary transition-colors"
            >
              Sem categoria
            </button>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-body text-text-secondary text-center">Nenhuma encontrada</div>
            ) : (
              filtered.map((opt, i) => (
                <button
                  key={opt.id}
                  onClick={() => select(opt.id)}
                  className={`w-full text-left px-3 py-1.5 text-body transition-colors flex items-center justify-between gap-1 ${
                    i === highlighted
                      ? 'bg-accent/20 text-text-primary'
                      : 'text-text-secondary hover:bg-accent/10 hover:text-text-primary'
                  } ${opt.isChild ? 'pl-5' : ''}`}
                  style={{ color: i === highlighted ? undefined : opt.color }}
                >
                  <span className="truncate">{opt.isChild ? `↳ ${opt.label}` : opt.label}</span>
                  {opt.isChild && opt.parentLabel && (
                    <span className="flex-shrink-0 text-caption text-text-secondary/60 italic">{opt.parentLabel}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

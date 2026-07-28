import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthLabel, getMonthYear, getMonthYearOffset } from '../../lib/utils';

interface Props {
  value: string; // "YYYY-MM"
  onChange: (monthYear: string) => void;
  /** Meses com lançamento ("YYYY-MM"): ficam plenos no calendário (os demais
   *  esmaecem) e definem até onde a paginação de ano alcança. */
  months?: string[];
}

const MONTH_ABBR = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/**
 * Seletor de mês: setas para passo a passo e, no rótulo, um popover de
 * calendário — um ano por vez, grade de 12 meses.
 *
 * O `<select>` nativo anterior empilhava TODOS os meses com lançamento numa
 * lista única, que só cresce com o tempo. O calendário é limitado por
 * construção: paginar ano é o único movimento, e 12 células cabem sem rolagem.
 */
export function MonthSelector({ value, onChange, months }: Props) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => Number(value.slice(0, 4)));
  const rootRef = useRef<HTMLDivElement>(null);

  const monthSet = useMemo(() => new Set(months), [months]);
  const { minYear, maxYear } = useMemo(() => {
    const years = (months ?? []).map((m) => Number(m.slice(0, 4)));
    years.push(Number(value.slice(0, 4)), Number(getMonthYear().slice(0, 4)));
    return { minYear: Math.min(...years), maxYear: Math.max(...years) };
  }, [months, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const nowKey = getMonthYear();

  return (
    <div ref={rootRef} className="relative flex items-center gap-1 sm:gap-2">
      <button
        onClick={() => onChange(getMonthYearOffset(value, -1))}
        className="tap flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary active:bg-elevated transition-colors"
        title="Mês anterior"
        aria-label="Mês anterior"
      >
        <ChevronLeft size={18} />
      </button>

      <button
        type="button"
        onClick={() => {
          setViewYear(Number(value.slice(0, 4)));
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Escolher mês"
        className="tap text-body text-text-primary bg-bg-secondary border border-border rounded-control px-2 py-1 capitalize min-w-[150px] sm:min-w-[160px] text-center cursor-pointer hover:border-accent/50 focus:outline-none focus:border-accent transition-colors"
      >
        {getMonthLabel(value)}
      </button>

      <button
        onClick={() => onChange(getMonthYearOffset(value, 1))}
        className="tap flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary active:bg-elevated transition-colors"
        title="Próximo mês"
        aria-label="Próximo mês"
      >
        <ChevronRight size={18} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Escolher mês"
          className="absolute right-0 top-full mt-1.5 z-50 w-[248px] bg-bg-card border border-border rounded-card shadow-lg shadow-black/40 p-2.5 space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              disabled={viewYear <= minYear}
              className="tap flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none transition-colors"
              aria-label="Ano anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-body font-semibold tnum text-text-primary">{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              disabled={viewYear >= maxYear}
              className="tap flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none transition-colors"
              aria-label="Próximo ano"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {MONTH_ABBR.map((name, i) => {
              const key = `${viewYear}-${String(i + 1).padStart(2, '0')}`;
              const selected = key === value;
              // Sem a lista de meses (páginas que não a passam), ninguém
              // esmaece — o esmaecido só faz sentido contra "tem lançamento".
              const hasData = !months || monthSet.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                  aria-pressed={selected}
                  className={`tap relative rounded-control py-1.5 text-body capitalize transition-colors ${
                    selected
                      ? 'bg-accent/15 text-accent font-semibold'
                      : hasData
                        ? 'text-text-secondary hover:bg-elevated hover:text-text-primary'
                        : 'text-ink-3/60 hover:bg-elevated hover:text-text-secondary'
                  }`}
                >
                  {name}
                  {key === nowKey && !selected && (
                    <span className="absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full bg-accent/70" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthLabel, getMonthYear, getMonthYearOffset } from '../../lib/utils';

/** Valor especial de "sem recorte de mês". Só existe quando `allowAll`. */
export const ALL_MONTHS = 'all';

interface Props {
  /** "YYYY-MM", ou `ALL_MONTHS` quando `allowAll` está ligado. */
  value: string;
  onChange: (monthYear: string) => void;
  /** Meses com lançamento ("YYYY-MM"): ficam plenos no calendário (os demais
   *  esmaecem) e definem até onde a paginação de ano alcança. */
  months?: string[];
  /**
   * Habilita "Todos os meses" — o recorte que a tela de Transações precisa e
   * as demais não: lá se procura um lançamento específico, se confere um
   * projeto que cruza meses, se busca por valor. Sem isso, aquela tela teria
   * de manter um `<select>` próprio e ficar sendo a única com um seletor de
   * mês diferente do resto do app.
   */
  allowAll?: boolean;
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
export function MonthSelector({ value, onChange, months, allowAll }: Props) {
  const [open, setOpen] = useState(false);
  const isAll = value === ALL_MONTHS;
  // Âncora para tudo que precisa de um mês concreto (ano exibido no
  // calendário, passo das setas). Em "todos os meses" não há mês selecionado,
  // então o calendário abre no mês corrente — `Number('all'.slice(0,4))`
  // seria NaN e envenenaria a paginação de ano em silêncio.
  const anchor = isAll ? getMonthYear() : value;
  const [viewYear, setViewYear] = useState(() => Number(anchor.slice(0, 4)));
  const rootRef = useRef<HTMLDivElement>(null);

  const monthSet = useMemo(() => new Set(months), [months]);
  const { minYear, maxYear } = useMemo(() => {
    const years = (months ?? []).map((m) => Number(m.slice(0, 4)));
    years.push(Number(anchor.slice(0, 4)), Number(getMonthYear().slice(0, 4)));
    return { minYear: Math.min(...years), maxYear: Math.max(...years) };
  }, [months, anchor]);

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
        onClick={() => onChange(getMonthYearOffset(anchor, -1))}
        disabled={isAll}
        className="tap flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary active:bg-elevated disabled:opacity-30 disabled:pointer-events-none transition-colors"
        title="Mês anterior"
        aria-label="Mês anterior"
      >
        <ChevronLeft size={18} />
      </button>

      <button
        type="button"
        onClick={() => {
          setViewYear(Number(anchor.slice(0, 4)));
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Escolher mês"
        /* `first-letter:uppercase` e não `capitalize`: este último maiúsculiza
           TODA palavra, e `getMonthLabel` devolve "julho de 2026" — virava
           "Julho De 2026". Só a primeira letra é o que o português pede, e é
           o que também deixa "Todos os meses" sair certo. */
        className="tap text-body text-text-primary bg-bg-secondary border border-border rounded-control px-2 py-1 first-letter:uppercase min-w-[150px] sm:min-w-[160px] text-center cursor-pointer hover:border-accent/50 focus:outline-none focus:border-accent transition-colors"
      >
        {isAll ? 'Todos os meses' : getMonthLabel(value)}
      </button>

      <button
        onClick={() => onChange(getMonthYearOffset(anchor, 1))}
        disabled={isAll}
        className="tap flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary active:bg-elevated disabled:opacity-30 disabled:pointer-events-none transition-colors"
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

          {allowAll && (
            <button
              type="button"
              onClick={() => { onChange(ALL_MONTHS); setOpen(false); }}
              aria-pressed={isAll}
              className={`tap w-full rounded-control py-1.5 text-body transition-colors border-t border-border/60 mt-1 pt-2 ${
                isAll ? 'text-accent font-semibold' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Todos os meses
            </button>
          )}
        </div>
      )}
    </div>
  );
}

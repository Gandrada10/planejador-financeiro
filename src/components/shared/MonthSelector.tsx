import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthLabel, getMonthYearOffset } from '../../lib/utils';

interface Props {
  value: string; // "YYYY-MM"
  onChange: (monthYear: string) => void;
  /** When provided, renders a dropdown list of months instead of a plain label */
  months?: string[];
}

export function MonthSelector({ value, onChange, months }: Props) {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <button
        onClick={() => onChange(getMonthYearOffset(value, -1))}
        className="tap flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary active:bg-elevated transition-colors"
        title="Mês anterior"
        aria-label="Mês anterior"
      >
        <ChevronLeft size={18} />
      </button>

      {months && months.length > 0 ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Mês"
          className="tap text-body text-text-primary bg-bg-secondary border border-border rounded-control px-2 py-1 focus:outline-none focus:border-accent cursor-pointer capitalize min-w-[150px] sm:min-w-[160px] text-center"
        >
          {months.includes(value) ? null : (
            <option value={value}>{getMonthLabel(value)}</option>
          )}
          {months.map((m) => (
            <option key={m} value={m} className="capitalize">
              {getMonthLabel(m)}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-body text-text-primary min-w-[140px] text-center capitalize">
          {getMonthLabel(value)}
        </span>
      )}

      <button
        onClick={() => onChange(getMonthYearOffset(value, 1))}
        className="tap flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary active:bg-elevated transition-colors"
        title="Próximo mês"
        aria-label="Próximo mês"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthLabel, getMonthYearOffset } from '../../lib/utils';

interface Props {
  value: string; // "YYYY-MM"
  onChange: (monthYear: string) => void;
}

export function MonthSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(getMonthYearOffset(value, -1))}
        className="p-1 text-text-secondary hover:text-text-primary transition-colors"
      >
        <ChevronLeft size={18} />
      </button>
      <span className="text-sm font-bold text-text-primary min-w-[140px] text-center capitalize">
        {getMonthLabel(value)}
      </span>
      <button
        onClick={() => onChange(getMonthYearOffset(value, 1))}
        className="p-1 text-text-secondary hover:text-text-primary transition-colors"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

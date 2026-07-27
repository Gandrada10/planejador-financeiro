import { ChevronDown, ChevronRight } from 'lucide-react';
import { CategoryIcon } from '../shared/CategoryIcon';
import { formatBRL, formatSignedBRL } from '../../lib/utils';
import {
  YOY_ROW_GRID,
  YOY_PREV_CELL,
  resolveTrend,
  resolveImpact,
  toneForDelta,
  type YoySubItem,
} from './yoyShared';

export function ColumnHeader({ deltaLabel = 'Δ R$' }: { deltaLabel?: string }) {
  return (
    <div className={`${YOY_ROW_GRID} px-4 py-1 text-caption uppercase tracking-wider text-ink-3`}>
      <span />
      <span>Categoria</span>
      <span className="text-right">Atual</span>
      <span className={`${YOY_PREV_CELL} text-right`}>Anterior</span>
      <span className="text-right">{deltaLabel}</span>
      <span className="text-right">%</span>
    </div>
  );
}

interface YoyRowProps {
  item: YoySubItem;
  /** 0 = categoria, 1 = subcategoria (recuada e recessiva). */
  depth?: 0 | 1;
  /** 'variance' = Δ é a variação; 'impact' = Δ é o impacto no resultado. */
  mode?: 'variance' | 'impact';
  higherIsBetter: boolean;
  hasPrev: boolean;
  prevYear: number;
  open?: boolean;
  hasSubs?: boolean;
  onToggle?: () => void;
}

export function YoyRow({
  item,
  depth = 0,
  mode = 'variance',
  higherIsBetter,
  hasPrev,
  prevYear,
  open = false,
  hasSubs = false,
  onToggle,
}: YoyRowProps) {
  const isSub = depth === 1;
  const impact = item.resultadoImpact ?? 0;
  const impactTone = resolveImpact(impact);

  const delta = mode === 'impact' ? impact : item.varianceAbs;
  const deltaTone =
    mode === 'impact' ? impactTone.color : toneForDelta(item.varianceAbs, higherIsBetter);

  const trend = resolveTrend(item.pct, higherIsBetter, {
    hasPrev,
    isNew: item.prev === 0 && item.curr !== 0,
  });
  // No modo impacto a seta seguiria o SINAL DO IMPACTO enquanto o número ao
  // lado é o percentual da categoria — daria "↓ +69,4%" numa despesa que subiu.
  // A semântica já está na coluna Impacto, então aqui o percentual fica mudo.
  const isImpact = mode === 'impact';
  const pctTone = isImpact ? 'text-ink-3' : trend.color;

  const nameTone = isSub ? 'text-text-secondary' : 'text-text-primary';
  const rowPad = isSub ? 'px-4 py-1 pl-10' : 'px-4 py-1.5';

  const content = (
    <>
      {hasSubs ? (
        open ? (
          <ChevronDown size={12} style={{ color: item.color }} />
        ) : (
          <ChevronRight size={12} style={{ color: item.color }} />
        )
      ) : (
        <ChevronRight size={12} style={{ color: item.color, opacity: 0.3 }} />
      )}

      <div className="flex items-center gap-1.5 min-w-0">
        <CategoryIcon
          icon={item.icon}
          size={13}
          className="flex-shrink-0"
          style={{ color: item.color }}
        />
        <span className={`text-body truncate ${nameTone}`}>{item.name}</span>
      </div>

      <span
        className="text-body tnum text-text-primary text-right"
        title={`${prevYear}: ${formatBRL(item.prev)}`}
      >
        {formatBRL(item.curr)}
      </span>

      <span className={`${YOY_PREV_CELL} text-body tnum text-text-secondary text-right`}>
        {formatBRL(item.prev)}
      </span>

      <span className={`text-body tnum font-semibold text-right ${deltaTone}`}>
        {formatSignedBRL(delta)}
      </span>

      <span className={`flex items-center justify-end gap-1 text-caption tnum ${pctTone}`}>
        {!isImpact && trend.hasValue && <trend.Icon size={11} className="flex-shrink-0" />}
        {trend.text}
      </span>
    </>
  );

  if (!hasSubs) {
    return <div className={`${YOY_ROW_GRID} ${rowPad}`}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`w-full text-left ${YOY_ROW_GRID} ${rowPad} hover:bg-elevated/60 cursor-pointer`}
    >
      {content}
    </button>
  );
}

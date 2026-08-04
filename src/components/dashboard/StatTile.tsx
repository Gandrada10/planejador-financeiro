import type { TrendingUp } from 'lucide-react';

/**
 * O KPI tile do dashboard e o grupo rotulado que o abriga. Vivia dentro de
 * `VitalSigns.tsx`; foi extraído quando o dashboard anual passou a precisar dos
 * MESMOS indicadores em outro recorte — sem isso seriam duas cópias do tile
 * derivando uma da outra a cada ajuste.
 *
 * Cada tile é rótulo → número-herói → delta com seta E sinal (nunca só cor).
 */

export interface TileDelta {
  Icon: typeof TrendingUp;
  tone: string;
  text: string;
  context: string;
}

/**
 * No grupo de 3, o celular usa 2 colunas com o TERCEIRO tile na linha inteira —
 * empilhar deixaria a tela com quase 2000px de rolagem, e o terceiro é
 * justamente a conclusão (Resultado), então ganhar largura é hierarquia.
 * Grupos de 2 e de 4 vivem em 2 colunas no celular e abrem no desktop.
 */
export function Group({
  label,
  cols = 3,
  children,
}: {
  label: string;
  cols?: 2 | 3 | 4;
  children: React.ReactNode;
}) {
  const grid =
    cols === 3
      ? 'grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 [&>*:nth-child(3)]:col-span-2 sm:[&>*:nth-child(3)]:col-span-1'
      : cols === 4
        ? 'grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3'
        : 'grid grid-cols-2 gap-2 sm:gap-3';

  return (
    <div>
      <p className="text-caption font-semibold uppercase tracking-wider text-ink-3 mb-1.5 px-0.5">
        {label}
      </p>
      <div className={grid}>{children}</div>
    </div>
  );
}

export function Tile({
  label,
  hint,
  value,
  valueSuffix,
  valueTone = 'text-text-primary',
  delta,
}: {
  label: string;
  hint?: string;
  value: string;
  valueSuffix?: string;
  valueTone?: string;
  delta?: TileDelta;
}) {
  return (
    <div
      className="bg-bg-card border border-border rounded-card px-3 py-3 sm:px-4 sm:py-3.5 flex flex-col gap-1 sm:gap-1.5 min-w-0"
      title={hint}
    >
      {/* Quebra em 2 linhas em vez de truncar: em 2 colunas no celular,
          "TAXA DE POUPANÇA · ANO" não cabe numa linha e virava "TAXA DE ...". */}
      <span className="text-caption font-semibold uppercase tracking-wider text-ink-3 leading-tight">{label}</span>
      {/* 21px no celular, 24px no desktop. O token text-kpi (28px) é para UM
          número-herói por tela — repetido em seis tiles ficava desproporcional. */}
      <span className={`text-[21px] sm:text-[24px] font-bold tracking-tight tnum leading-none truncate ${valueTone}`}>
        {value}
        {valueSuffix && <span className="text-caption sm:text-body font-medium text-text-secondary tracking-normal">{valueSuffix}</span>}
      </span>
      {delta ? (
        <span className={`flex items-baseline gap-x-1.5 flex-wrap text-caption font-semibold tnum ${delta.tone} min-w-0`}>
          <delta.Icon size={12} className="flex-shrink-0 self-center" />
          <span>{delta.text}</span>
          {/* Quebra em vez de truncar: com o valor da média junto, o contexto
              não cabe numa linha em 2 colunas de celular. */}
          {delta.context && <span className="text-ink-3 font-normal">{delta.context}</span>}
        </span>
      ) : (
        <span className="text-caption text-ink-3">—</span>
      )}
    </div>
  );
}

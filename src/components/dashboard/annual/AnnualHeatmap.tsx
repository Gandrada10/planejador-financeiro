import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatBRL0, formatBRL } from '../../../lib/utils';
import { shortMonthLabel } from '../../../lib/annualStats';
import type { AnnualMatrix, MatrixRow, AnnualPeriod } from '../../../lib/annualStats';

interface Props {
  matrix: AnnualMatrix;
  period: AnnualPeriod;
}

/** Alfa máximo da rampa: acima disso o texto branco perde contraste na célula. */
const MAX_ALPHA = 0.34;

/**
 * Categoria × mês nos 12 meses da janela: onde o dinheiro foi, e quando.
 *
 * Só DESPESAS: receita tem duas ou três linhas e nenhuma variação interessante
 * de mês para mês — um mapa de calor dela seria uma tabela cara de renderizar
 * para dizer "o salário caiu todo mês". O total de receitas do período já está
 * nos indicadores, no gráfico e no fluxo de caixa.
 *
 * ── A correção de escala ──
 * O relatório de evolução por categoria normaliza a cor POR LINHA: cada linha
 * tem o próprio máximo, então uma célula de R$ 80 em "Farmácia" fica tão escura
 * quanto uma de R$ 3.000 em "Moradia". A cor mente sobre a comparação e as
 * linhas não se comparam entre si — o defeito registrado em MELHORIAS-VISUAIS.
 *
 * Aqui a escala é da TABELA INTEIRA (um único máximo), então a intensidade
 * significa a mesma coisa em qualquer célula e a legenda pode declarar o topo
 * da escala.
 */
export function AnnualHeatmap({ matrix, period }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasAny = matrix.expense.length > 0;

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Onde o dinheiro foi</h3>
          <p className="text-caption text-ink-3 mt-0.5">
            {period.label} · quanto mais escura a célula, maior o valor · toque numa categoria para
            abrir as subcategorias
          </p>
        </div>
        {matrix.expenseMax > 0 && <Legend max={matrix.expenseMax} />}
      </div>

      {!hasAny ? (
        <p className="text-body text-text-secondary">Nenhuma despesa categorizada na janela.</p>
      ) : (
        <div className="scroll-x">
          <table className="w-full min-w-[820px] text-body border-separate border-spacing-0">
            <thead>
              <tr className="text-caption uppercase tracking-wider text-ink-3">
                <th className="sticky left-0 z-20 bg-bg-card text-left font-semibold py-1.5 pr-3 min-w-[150px]">
                  Categoria
                </th>
                {period.months.map((m) => (
                  <th key={m} className="text-right font-semibold py-1.5 px-1.5 whitespace-nowrap">
                    {shortMonthLabel(m).slice(0, 3)}
                  </th>
                ))}
                <th className="text-right font-semibold py-1.5 px-2 whitespace-nowrap">Média</th>
                <th className="text-right font-semibold py-1.5 pl-2 whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody>
              <Block
                title="Despesas"
                rows={matrix.expense}
                max={matrix.expenseMax}
                totals={matrix.expenseTotals}
                grandTotal={matrix.expenseTotal12m}
                hue="255 110 95"
                period={period}
                expanded={expanded}
                onToggle={toggle}
              />
            </tbody>
          </table>
        </div>
      )}

      {/* As duas conclusões que o mapa sozinho não entrega: onde mexer dá
          resultado, e quais meses pesam. */}
      {(matrix.expenseConcentration !== null || matrix.expensivestMonths.length > 0) && (
        <div className="pt-2 border-t border-border space-y-1 text-body text-text-secondary leading-snug">
          {/* Só vale dizer com base larga: com 6 categorias, "as 5 maiores são
              98%" é aritmética, não descoberta. */}
          {matrix.expenseConcentration !== null && matrix.expense.length >= 9 && (
            <p>
              As 5 maiores categorias concentram{' '}
              <span className="tnum font-semibold text-text-primary">
                {(matrix.expenseConcentration * 100).toFixed(0)}%
              </span>{' '}
              das despesas — é onde mexer muda o resultado.
            </p>
          )}
          {matrix.expensivestMonths.length > 0 && (
            <p>
              Seus meses caros:{' '}
              <span className="font-semibold text-text-primary">
                {matrix.expensivestMonths.map((m) => shortMonthLabel(m)).join(', ')}
              </span>{' '}
              — gastaram acima da média da janela.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ max }: { max: number }) {
  return (
    <div className="flex items-center gap-1.5 text-caption text-ink-3 flex-shrink-0">
      <span>R$ 0</span>
      <span className="flex h-2.5 w-24 rounded-[3px] overflow-hidden">
        {[0.08, 0.25, 0.45, 0.7, 1].map((s) => (
          <span
            key={s}
            className="flex-1"
            style={{ backgroundColor: `rgb(255 110 95 / ${s * MAX_ALPHA})` }}
          />
        ))}
      </span>
      <span className="tnum">{formatBRL0(max)}</span>
    </div>
  );
}

function Block({
  title,
  rows,
  max,
  totals,
  grandTotal,
  hue,
  period,
  expanded,
  onToggle,
}: {
  title: string;
  rows: MatrixRow[];
  max: number;
  totals: Record<string, number>;
  grandTotal: number;
  hue: string;
  period: AnnualPeriod;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <>
      <tr>
        <td
          colSpan={period.months.length + 3}
          className="sticky left-0 bg-bg-card text-caption font-semibold uppercase tracking-wider text-ink-3 pt-3 pb-1"
        >
          {title}
        </td>
      </tr>

      {rows.map((row) => {
        const open = expanded.has(row.categoryId);
        const hasChildren = row.children.length > 0;
        return (
          // A chave vai no Fragment (o elemento mapeado), não nas linhas
          // dentro dele — no filho, o React não consegue casar a raiz.
          <Fragment key={row.categoryId}>
            <Line
              row={row}
              max={max}
              hue={hue}
              period={period}
              open={open}
              hasChildren={hasChildren}
              onToggle={() => onToggle(row.categoryId)}
            />
            {open &&
              row.children.map((child) => (
                <Line
                  key={child.categoryId}
                  row={child}
                  max={max}
                  hue={hue}
                  period={period}
                  open={false}
                  hasChildren={false}
                  sub
                />
              ))}
          </Fragment>
        );
      })}

      <tr className="font-semibold text-text-secondary">
        <td className="sticky left-0 z-10 bg-bg-card py-1.5 pr-3 border-t border-border text-caption">
          Total {title.toLowerCase()}
        </td>
        {period.months.map((m) => (
          <td key={m} className="text-right py-1.5 px-1.5 tnum border-t border-border whitespace-nowrap">
            {totals[m] ? compact(totals[m]) : '—'}
          </td>
        ))}
        <td className="text-right py-1.5 px-2 tnum border-t border-border">
          {compact(grandTotal / period.months.length)}
        </td>
        <td className="text-right py-1.5 pl-2 tnum border-t border-border whitespace-nowrap text-text-primary">
          {formatBRL0(grandTotal)}
        </td>
      </tr>
    </>
  );
}

function Line({
  row,
  max,
  hue,
  period,
  open,
  hasChildren,
  onToggle,
  sub,
}: {
  row: MatrixRow;
  max: number;
  hue: string;
  period: AnnualPeriod;
  open: boolean;
  hasChildren: boolean;
  onToggle?: () => void;
  sub?: boolean;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <tr className="group">
      <td
        className={`sticky left-0 z-10 bg-bg-card py-1 pr-3 border-t border-border ${
          sub ? 'pl-5 text-text-secondary' : ''
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="tap flex items-center gap-1.5 min-w-0 w-full text-left hover:text-accent transition-colors"
          >
            <Chevron size={12} className="flex-shrink-0 text-ink-3" />
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
            <span className="truncate">{row.name}</span>
          </button>
        ) : (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className={sub ? 'w-3 flex-shrink-0' : 'w-0'} />
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
            <span className="truncate">{row.name}</span>
          </span>
        )}
      </td>

      {period.months.map((m) => {
        const v = row.byMonth[m] ?? 0;
        // Raiz quadrada na rampa: valores pequenos ficariam indistinguíveis do
        // fundo numa escala linear ancorada no máximo do bloco.
        const alpha = max > 0 && v > 0 ? Math.sqrt(v / max) * MAX_ALPHA : 0;
        return (
          <td
            key={m}
            className="text-right py-1 px-1.5 tnum whitespace-nowrap border-t border-border"
            style={alpha > 0 ? { backgroundColor: `rgb(${hue} / ${alpha})` } : undefined}
            title={v > 0 ? `${row.name} · ${shortMonthLabel(m)}: ${formatBRL(v)}` : undefined}
          >
            {v > 0 ? compact(v) : <span className="text-ink-3">—</span>}
          </td>
        );
      })}

      <td className="text-right py-1 px-2 tnum text-text-secondary border-t border-border whitespace-nowrap">
        {compact(row.average)}
      </td>
      <td className="text-right py-1 pl-2 tnum font-semibold border-t border-border whitespace-nowrap">
        {formatBRL0(row.total12m)}
      </td>
    </tr>
  );
}

/**
 * Célula de matriz: 12 colunas de moeda cheia não cabem em tela nenhuma, então
 * a grade usa milhares sem símbolo ("3,4k"). O valor exato fica no `title` e nas
 * colunas de Média/Total, que têm largura para ele.
 */
function compact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(1).replace('.', ',')}k`;
  return String(Math.round(v));
}

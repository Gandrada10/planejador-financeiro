import { Sankey, Layer, Rectangle, ResponsiveContainer } from 'recharts';
import { MONEY, OTHER_COLOR, FONT } from '../../lib/chartTheme';
import { formatBRL0 } from '../../lib/utils';

interface CategorySlice {
  name: string;
  color: string;
  /** Negativo, como vem do DashboardPage. */
  amount: number;
}

interface Props {
  /** Receitas do mês (positivo). */
  income: number;
  /** Resultado do mês (receitas + despesas, sinal livre). */
  balance: number;
  /** Despesas por categoria-mãe do mês. */
  categories: CategorySlice[];
}

const TOP_N = 8;

interface SankeyNodeDef {
  name: string;
  color: string;
  /** Fatia do caixa do mês, pré-computada (%) — evita closure no shape. */
  share: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- recharts não tipa os
   props injetados em node/link customizados do Sankey */

// Rótulos sempre à DIREITA da barra: a coluna final escreve na margem
// reservada (margin.right) e as demais escrevem sobre o vão dos fluxos.
function SankeyNodeShape(props: any) {
  const { x, y, width, height, payload } = props;
  const tx = x + width + 8;
  const compact = height < 26;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={payload.color} radius={2} />
      <text
        x={tx}
        y={y + height / 2 + (compact ? 3.5 : -2)}
        textAnchor="start"
        fontFamily={FONT}
        fontSize={11}
        fontWeight={600}
        fill="#f5f4f2"
      >
        {payload.name}
        {compact && (
          <tspan fontWeight={400} fill="#8f8e89">
            {' '}
            {formatBRL0(payload.value)}
          </tspan>
        )}
      </text>
      {!compact && (
        <text
          x={tx}
          y={y + height / 2 + 12}
          textAnchor="start"
          fontFamily={FONT}
          fontSize={10.5}
          fill="#8f8e89"
        >
          {formatBRL0(payload.value)}
          {payload.share !== null && ` · ${payload.share.toFixed(0)}%`}
        </text>
      )}
    </Layer>
  );
}

// Fita com gradiente da cor de origem para a de destino, como no Monarch —
// o traço chapado translúcido lia como fio solto, não como fluxo de dinheiro.
function SankeyLinkShape(props: any) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload, index } = props;
  const id = `sankey-link-${index}`;
  return (
    <Layer>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={sourceX} x2={targetX} y1={sourceY} y2={targetY}>
          <stop offset="0%" stopColor={payload.source.color} stopOpacity={0.45} />
          <stop offset="100%" stopColor={payload.target.color} stopOpacity={0.45} />
        </linearGradient>
      </defs>
      <path
        d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={Math.max(linkWidth, 1)}
      />
    </Layer>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fluxo do dinheiro do mês (diagrama de Sankey, à la Monarch Money):
 * fontes → caixa do mês → destinos.
 *
 *   Receitas ─┐                ┌─ Moradia
 *             ├─ Caixa do mês ─┼─ Alimentação …
 *   Reserva ─┘                 └─ Sobra
 *
 * "Da reserva" só aparece em mês deficitário (o que saiu além do que entrou
 * veio de algum lugar); "Sobra" só em mês superavitário. Assim o diagrama
 * SEMPRE fecha: entradas = saídas, sem fluxo negativo — que Sankey não tem
 * como representar.
 */
export function CashFlowSankey({ income, balance, categories }: Props) {
  const expenses = categories
    .map((c) => ({ ...c, value: Math.abs(c.amount) }))
    .filter((c) => c.value > 0);

  const totalExp = expenses.reduce((s, c) => s + c.value, 0);
  if (totalExp === 0 && income <= 0) {
    return <p className="text-caption text-ink-3 text-center py-10">Sem movimento neste mês.</p>;
  }

  // Fatias minúsculas viram "Outras" — abaixo de 1,5% o rótulo não cabe.
  const big = expenses.filter((c, i) => i < TOP_N && c.value / totalExp >= 0.015);
  const restTotal = totalExp - big.reduce((s, c) => s + c.value, 0);

  const available = income + (balance < 0 ? -balance : 0);
  const shareOf = (v: number) => (available > 0 ? (v / available) * 100 : null);

  const nodes: SankeyNodeDef[] = [];
  const links: Array<{ source: number; target: number; value: number }> = [];
  const push = (n: SankeyNodeDef) => nodes.push(n) - 1;

  const sources: Array<{ idx: number; value: number }> = [];
  if (income > 0) {
    sources.push({ idx: push({ name: 'Receitas', color: MONEY.income, share: shareOf(income) }), value: income });
  }
  if (balance < 0) {
    sources.push({
      idx: push({ name: 'Da reserva', color: MONEY.expense, share: shareOf(-balance) }),
      value: -balance,
    });
  }

  const middleIdx = push({ name: 'Caixa do mês', color: MONEY.balance, share: null });
  for (const s of sources) links.push({ source: s.idx, target: middleIdx, value: s.value });

  for (const c of big) {
    links.push({
      source: middleIdx,
      target: push({ name: c.name, color: c.color, share: shareOf(c.value) }),
      value: c.value,
    });
  }
  if (restTotal > 0.005) {
    links.push({
      source: middleIdx,
      target: push({
        name: `Outras (${expenses.length - big.length})`,
        color: OTHER_COLOR,
        share: shareOf(restTotal),
      }),
      value: restTotal,
    });
  }
  if (balance > 0) {
    links.push({
      source: middleIdx,
      target: push({ name: 'Sobra', color: MONEY.income, share: shareOf(balance) }),
      value: balance,
    });
  }

  return (
    // Altura maior + padding menor entre nós = fitas que PREENCHEM o espaço
    // (a la Monarch), em vez de fios finos boiando em fundo preto.
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={{ nodes, links }}
          nodeWidth={10}
          nodePadding={8}
          margin={{ top: 12, right: 150, bottom: 12, left: 4 }}
          node={SankeyNodeShape}
          link={SankeyLinkShape}
        />
      </ResponsiveContainer>
    </div>
  );
}

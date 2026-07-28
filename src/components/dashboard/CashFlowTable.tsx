import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatBRL, formatBRL0 } from '../../lib/utils';
import type { Account } from '../../types';

export interface AccountFlow {
  accountName: string;
  type?: Account['type'];
  entries: number;
  exits: number;
  balance: number;
  isCard?: boolean;
  cycleStatus?: 'open' | 'closed';
}

interface Props {
  data: AccountFlow[];
  totalEntries: number;
  totalExits: number;
  totalBalance: number;
  yearBalance: number;
  avg12months: number;
  currentYear: string;
  /** "junho de 2026" — janela dos números do mês. */
  monthLabel: string;
}

/**
 * Resultados de caixa agrupados por TIPO de conta, com subtotal por grupo.
 *
 * A lista plana anterior misturava naturezas diferentes na mesma coluna —
 * saldo em conta corrente e dívida de cartão somados como se fossem a mesma
 * coisa. O agrupamento deixa explícito o que é dinheiro em caixa, o que é
 * fatura a pagar e o que é benefício.
 */
const GROUPS: Array<{ label: string; types: Array<Account['type'] | undefined> }> = [
  { label: 'Conta corrente', types: ['corrente'] },
  { label: 'Cartões de crédito', types: ['cartao'] },
  { label: 'Vale / benefício', types: ['beneficio'] },
  { label: 'Poupança e investimentos', types: ['poupanca', 'investimento', 'outro'] },
  { label: 'Sem conta', types: [undefined] },
];

/**
 * Faixa de leitura no hover. Tinta branca em vez de `bg-elevated`: o elevated
 * fica a 8 níveis do fundo do card e some numa faixa de 1 linha.
 * Só em ponteiro FINO: no toque não existe hover e o estado ficaria grudado
 * na última linha tocada.
 */
const ROW_HOVER = '[@media(hover:hover)]:hover:bg-white/[0.06] transition-colors';

const tone = (v: number) => (v === 0 ? 'text-ink-3' : v > 0 ? 'text-positive' : 'text-negative');

/**
 * Card de caixa: o RESULTADO por conta é o corpo; entradas e saídas viram
 * contexto.
 *
 * A versão anterior era uma tabela de 4 colunas com as três conclusões —
 * resultado do mês, acumulado do ano e média 12M — enfileiradas no rodapé com
 * o mesmo peso de "Sodexo Refeição". Aqui elas sobem para tiles no topo, e a
 * decomposição por conta responde só "quem segurou e quem furou o mês"; o par
 * entradas/saídas de cada conta fica no title da linha.
 *
 * Uma renderização só para celular e desktop: sem as 4 colunas de dinheiro, a
 * lista cabe em 375px sem precisar da versão empilhada que existia antes.
 */
export function CashFlowTable({
  data,
  totalEntries,
  totalExits,
  totalBalance,
  yearBalance,
  avg12months,
  currentYear,
  monthLabel,
}: Props) {
  const groups = GROUPS.map((g) => {
    const rows = data.filter((d) => g.types.includes(d.type));
    return {
      label: g.label,
      rows,
      entries: rows.reduce((s, r) => s + r.entries, 0),
      exits: rows.reduce((s, r) => s + r.exits, 0),
      balance: rows.reduce((s, r) => s + r.balance, 0),
    };
  }).filter((g) => g.rows.length > 0);

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-title font-semibold text-text-primary">Resultados de caixa</h3>
        <p className="text-caption text-ink-3">{monthLabel} · por conta</p>
      </div>

      {/* 3 em 326px dão ~105px cada e os rótulos viravam "ACUMULAD…". No
          celular são 2 colunas com o terceiro na linha inteira, o mesmo
          arranjo dos indicadores do topo. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 [&>*:nth-child(3)]:col-span-2 sm:[&>*:nth-child(3)]:col-span-1">
        <Conclusion label="Resultado do mês" value={totalBalance} hint="entradas − saídas" />
        <Conclusion label={`Acumulado ${currentYear}`} value={yearBalance} hint="até o mês selecionado" />
        <Conclusion label="Média mensal" value={avg12months} hint="últimos 12 meses" />
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <span className="flex items-center gap-1.5 text-caption text-ink-3">
          <TrendingUp size={12} className="text-positive flex-shrink-0" /> entrou{' '}
          <span className="tnum text-positive">{formatBRL0(totalEntries)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-caption text-ink-3">
          <TrendingDown size={12} className="text-negative flex-shrink-0" /> saiu{' '}
          <span className="tnum text-negative">{formatBRL0(-totalExits)}</span>
        </span>
      </div>

      <div className="space-y-2.5">
        {groups.map((g) => (
          <div key={g.label} className="space-y-0.5">
            {/* Cabeçalho de grupo com FAIXA e texto claro: sem isso ele ficava
                menor e mais apagado que as contas que encabeça — subordinado
                justamente ao que deveria agrupar. */}
            <div className="flex items-baseline justify-between gap-2 rounded-[6px] bg-white/[0.055] px-2 py-1">
              <span className="text-caption font-semibold uppercase tracking-wider text-text-primary truncate">
                {g.label}
              </span>
              <span className={`text-body tnum font-bold flex-shrink-0 ${tone(g.balance)}`}>
                {g.balance > 0 ? '+' : ''}
                {formatBRL0(g.balance)}
              </span>
            </div>

            {g.rows.map((d) => (
              <div
                key={d.accountName}
                title={`Entradas ${formatBRL(d.entries)} · Saídas ${formatBRL(d.exits)}`}
                className={`flex items-baseline justify-between gap-2 rounded px-2 py-0.5 ${ROW_HOVER}`}
              >
                <span className="text-body text-text-secondary truncate">
                  {d.accountName}
                  {d.isCard && <CycleChip status={d.cycleStatus} />}
                </span>
                <span className={`text-body tnum flex-shrink-0 ${tone(d.balance)}`}>
                  {d.balance === 0 ? '—' : formatBRL0(d.balance)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Uma das três conclusões do card, no idioma dos tiles do topo do dashboard. */
function Conclusion({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="bg-bg-secondary rounded-control px-2.5 py-2 min-w-0">
      <p className="text-caption uppercase tracking-wider text-ink-3 truncate">{label}</p>
      <p className={`text-[17px] sm:text-[19px] font-bold tracking-tight tnum truncate ${tone(value)}`}>
        {value > 0 ? '+' : ''}
        {formatBRL0(value)}
      </p>
      <p className="text-caption text-ink-3 truncate">{hint}</p>
    </div>
  );
}

/**
 * Fatura fechada x aberta: numa fatura aberta o valor ainda vai mudar até o
 * fechamento, então o número da linha é parcial por natureza.
 */
function CycleChip({ status }: { status?: 'open' | 'closed' }) {
  if (!status) return null;
  return (
    <span
      className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium align-middle ${
        status === 'closed'
          ? 'bg-text-secondary/15 text-text-secondary'
          : 'bg-accent/15 text-accent'
      }`}
    >
      {status === 'closed' ? 'Fechada' : 'Aberta'}
    </span>
  );
}

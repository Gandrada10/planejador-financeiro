import { formatBRL0 } from '../../lib/utils';
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
 * Card de caixa: o mês decomposto por conta, com entradas, saídas e resultado
 * em cada linha.
 *
 * A versão anterior era uma tabela de 4 colunas com cabeçalho em maiúsculas e
 * três conclusões enfileiradas no rodapé — resultado do mês, acumulado do ano e
 * média 12M — com o mesmo peso de "Sodexo Refeição".
 *
 * O acumulado do ano saiu: ele é OUTRA métrica, de outro período, e já vive no
 * card "O que puxou o ano", onde fecha a conta com receitas e despesas e
 * carrega a comparação com o ano anterior. A média 12M também saiu, mas por
 * outro motivo: ela é a RÉGUA do resultado do mês, e régua viaja junto com o
 * que mede — agora aparece no tile "Resultado do mês", lá em cima, junto das
 * outras referências de 12 meses.
 *
 * Sobra o que o card é de fato: um mês, conta a conta. Uma renderização só
 * para celular e desktop — no estreito o par entradas/saídas desce para a
 * segunda linha em vez de espremer três colunas de dinheiro em 375px.
 */
export function CashFlowTable({
  data,
  totalEntries,
  totalExits,
  totalBalance,
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

      <div className="space-y-2.5">
        {groups.map((g) => (
          <div key={g.label} className="space-y-0.5">
            {/* Cabeçalho de grupo com FAIXA e texto claro: sem isso ele ficava
                menor e mais apagado que as contas que encabeça — subordinado
                justamente ao que deveria agrupar. */}
            <Line
              name={g.label}
              entries={g.entries}
              exits={g.exits}
              balance={g.balance}
              variant="group"
            />
            {g.rows.map((d) => (
              <Line
                key={d.accountName}
                name={d.accountName}
                entries={d.entries}
                exits={d.exits}
                balance={d.balance}
                chip={d.isCard ? <CycleChip status={d.cycleStatus} /> : null}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="pt-2 border-t border-border">
        <Line
          name="Total do mês"
          entries={totalEntries}
          exits={totalExits}
          balance={totalBalance}
          variant="total"
        />
      </div>
    </div>
  );
}

/**
 * Uma linha do card. No estreito o par entradas/saídas desce para a segunda
 * linha (ordem trocada pelo `order`), porque três colunas de dinheiro em 375px
 * cortam nome e valor — foi o que motivava a renderização empilhada separada
 * que existia antes.
 */
function Line({
  name,
  entries,
  exits,
  balance,
  chip,
  variant,
}: {
  name: string;
  entries: number;
  exits: number;
  balance: number;
  chip?: React.ReactNode;
  variant?: 'group' | 'total';
}) {
  const strong = variant === 'group' || variant === 'total';
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_6rem] gap-x-2 items-baseline rounded-[6px] px-2 py-1 ${
        variant === 'group' ? 'bg-white/[0.055]' : variant === 'total' ? '' : ROW_HOVER
      }`}
    >
      <span
        className={`order-1 truncate ${
          variant === 'group'
            ? 'text-caption font-semibold uppercase tracking-wider text-text-primary'
            : variant === 'total'
              ? 'text-body font-semibold text-text-primary'
              : 'text-body text-text-secondary'
        }`}
      >
        {name}
        {chip}
      </span>

      {/* Sem entradas, o par vira só a saída: "— − R$ 111" se lê como uma
          subtração de nada, não como "não entrou e saiu 111". */}
      <span className="order-3 sm:order-2 col-span-2 sm:col-span-1 text-caption tnum text-ink-3 sm:text-right">
        {entries !== 0 && <span className="text-positive/90">{formatBRL0(entries)}</span>}
        {entries !== 0 && exits !== 0 && ' − '}
        {exits !== 0 && <span className="text-negative/90">{formatBRL0(-exits)}</span>}
        {entries === 0 && exits === 0 && '—'}
      </span>

      <span
        className={`order-2 sm:order-3 tnum text-right ${strong ? 'text-body font-bold' : 'text-body'} ${tone(balance)}`}
      >
        {balance === 0 ? '—' : `${balance > 0 ? '+' : ''}${formatBRL0(balance)}`}
      </span>
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

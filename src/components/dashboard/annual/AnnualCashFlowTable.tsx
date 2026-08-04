import { formatBRL } from '../../../lib/utils';
import type { AnnualStats } from '../../../lib/annualStats';

interface Props {
  stats: AnnualStats;
}

/**
 * O fluxo de caixa mês a mês da janela, com o SALDO ACUMULADO — a coluna que
 * responde "e no fim das contas, para onde foi o caixa?", que nem o gráfico nem
 * os indicadores dão. Mesmo formato do relatório de fluxo de caixa, para as
 * duas telas se lerem igual; aqui os números chegam prontos por prop em vez de
 * serem recalculados.
 *
 * A micro-barra na coluna Resultado é o que faz a tabela valer a largura
 * inteira: com 12 linhas, a comparação entre meses vira leitura de relance em
 * vez de comparação de dígitos.
 */
export function AnnualCashFlowTable({ stats }: Props) {
  const { rows, saldoAnterior, m12, period } = stats;

  // Escala das micro-barras: o maior resultado em módulo da janela. Comum às 12
  // linhas — barra normalizada por linha não compara nada.
  const scale = Math.max(...rows.map((r) => Math.abs(r.result)), 1);

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="min-w-0">
        <h3 className="text-title font-semibold text-text-primary">Fluxo de caixa</h3>
        <p className="text-caption text-ink-3 mt-0.5">
          {period.label} · saldo acumulado a partir de tudo que veio antes
        </p>
      </div>

      <div className="scroll-x">
        <table className="w-full min-w-[520px] text-body">
          <thead>
            <tr className="text-caption uppercase tracking-wider text-ink-3">
              <th className="text-left font-semibold py-1.5 pr-2">Período</th>
              <th className="text-right font-semibold py-1.5 px-2">Entradas</th>
              <th className="text-right font-semibold py-1.5 px-2">Saídas</th>
              <th className="text-right font-semibold py-1.5 px-2">Resultado</th>
              <th className="text-right font-semibold py-1.5 pl-2">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border text-text-secondary">
              <td className="py-1.5 pr-2 text-caption" colSpan={4}>
                Saldo anterior ao período
              </td>
              <td className="py-1.5 pl-2 text-right tnum text-caption">{formatBRL(saldoAnterior)}</td>
            </tr>

            {rows.map((r, i) => {
              // Separador na virada do ano: dez → jan é a única quebra que
              // muda o significado das linhas seguintes.
              const yearBreak = i > 0 && r.isCurrentYear && !rows[i - 1].isCurrentYear;
              return (
                <tr
                  key={r.key}
                  className={`border-t transition-colors hover:bg-elevated/40 ${
                    yearBreak ? 'border-ink-3/40' : 'border-border'
                  } ${r.empty ? 'opacity-40' : ''}`}
                >
                  <td className="py-1.5 pr-2 whitespace-nowrap">{r.label}</td>
                  <td className="py-1.5 px-2 text-right tnum text-positive">
                    {r.income > 0 ? formatBRL(r.income) : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-right tnum text-negative">
                    {r.expense > 0 ? formatBRL(r.expense) : '—'}
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="flex items-center justify-end gap-2">
                      <Bar value={r.result} scale={scale} />
                      <span
                        className={`tnum whitespace-nowrap ${
                          r.result > 0 ? 'text-positive' : r.result < 0 ? 'text-negative' : 'text-ink-3'
                        }`}
                      >
                        {r.result > 0 ? '+' : ''}
                        {formatBRL(r.result)}
                      </span>
                    </div>
                  </td>
                  <td className="py-1.5 pl-2 text-right tnum text-text-secondary whitespace-nowrap">
                    {formatBRL(r.saldo)}
                  </td>
                </tr>
              );
            })}

            <tr className="border-t-2 border-ink-3/40 font-semibold">
              <td className="py-2 pr-2">Total · 12 meses</td>
              <td className="py-2 px-2 text-right tnum text-positive">{formatBRL(m12.income)}</td>
              <td className="py-2 px-2 text-right tnum text-negative">{formatBRL(m12.expense)}</td>
              <td
                className={`py-2 px-2 text-right tnum ${
                  m12.result >= 0 ? 'text-positive' : 'text-negative'
                }`}
              >
                {m12.result > 0 ? '+' : ''}
                {formatBRL(m12.result)}
              </td>
              <td className="py-2 pl-2 text-right tnum text-text-primary">
                {formatBRL(rows.length > 0 ? rows[rows.length - 1].saldo : saldoAnterior)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Micro-barra bidirecional a partir de um eixo central: positivo cresce para a
 * direita, negativo para a esquerda. O eixo comum é o que permite varrer a
 * coluna e ver o padrão do ano sem ler um número sequer.
 */
function Bar({ value, scale }: { value: number; scale: number }) {
  const share = Math.min(Math.abs(value) / scale, 1);
  const positive = value > 0;
  return (
    <span className="hidden sm:flex items-center w-16 h-2 flex-shrink-0" aria-hidden="true">
      <span className="flex-1 flex justify-end pr-px">
        {!positive && value !== 0 && (
          <span
            className="h-2 rounded-l-[2px] bg-negative"
            style={{ width: `${share * 100}%` }}
          />
        )}
      </span>
      <span className="w-px h-2.5 bg-ink-3/40" />
      <span className="flex-1 pl-px">
        {positive && (
          <span
            className="block h-2 rounded-r-[2px] bg-positive"
            style={{ width: `${share * 100}%` }}
          />
        )}
      </span>
    </span>
  );
}

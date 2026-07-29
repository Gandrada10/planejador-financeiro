import type { Transaction } from '../types';

/**
 * Lotes de importação — agrupa as transações pelo `importBatch` que o
 * `importBatch()` do `useTransactions` carimba em cada linha gravada
 * (`import_<timestamp>`).
 *
 * ── Por que isto existe ────────────────────────────────────────────────────
 * O carimbo já era gravado desde sempre, mas nenhuma tela o lia. Na prática
 * uma importação era irreversível e invisível: se ela caísse na conta errada,
 * o único caminho era caçar os lançamentos um a um pela lista, apagar na mão
 * e torcer para não sobrar nem apagar demais. Com centenas de linhas isso
 * termina em "apaguei 105 dos 108 e não sei onde estão os outros 3".
 *
 * Como o carimbo é o mesmo para todas as linhas de uma importação, ele já
 * responde tudo: quantas entraram, para onde foram, quanto somam, e quais
 * apagar para desfazer. Só faltava alguém perguntar.
 */

export interface ImportBatchSummary {
  /** O `importBatch` gravado nas transações (`import_<timestamp>`). */
  id: string;
  /** Momento da importação, lido do próprio id. `null` se o formato mudar. */
  at: Date | null;
  /** Quantas transações ainda existem deste lote. Cai quando o usuário apaga
   *  linhas à mão — é o número que revela uma limpeza pela metade. */
  count: number;
  /** Contas de destino, com a contagem de cada uma. Uma importação que caiu
   *  em vários lugares aparece aqui com várias entradas — inclusive a conta
   *  VAZIA, que é o sintoma mais difícil de achar pela lista. */
  accounts: { name: string; count: number }[];
  /** Soma dos valores (assinada, em BRL). */
  total: number;
  /** Período coberto pelos lançamentos do lote. */
  firstDate: Date | null;
  lastDate: Date | null;
  /** Ids das transações — o que a exclusão em lote consome. */
  ids: string[];
  /** Amostra das descrições, para reconhecer o lote de relance. */
  sample: string[];
}

/** `import_1753800000000` → Date. Tolerante: id fora do padrão vira `null`. */
function parseBatchDate(id: string): Date | null {
  const m = /^import_(\d{10,})$/.exec(id);
  if (!m) return null;
  const d = new Date(Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Agrupa as transações por lote, da importação mais recente para a mais
 * antiga. Transações sem carimbo (criadas à mão, ou importadas antes do
 * campo existir) ficam de fora — não há lote a desfazer nelas.
 */
export function groupImportBatches(transactions: Transaction[]): ImportBatchSummary[] {
  const byBatch = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.importBatch) continue;
    const list = byBatch.get(t.importBatch);
    if (list) list.push(t);
    else byBatch.set(t.importBatch, [t]);
  }

  const out: ImportBatchSummary[] = [];
  for (const [id, list] of byBatch) {
    const accounts = new Map<string, number>();
    let total = 0;
    let firstDate: Date | null = null;
    let lastDate: Date | null = null;
    for (const t of list) {
      accounts.set(t.account, (accounts.get(t.account) ?? 0) + 1);
      total += t.amount;
      if (!firstDate || t.date < firstDate) firstDate = t.date;
      if (!lastDate || t.date > lastDate) lastDate = t.date;
    }
    out.push({
      id,
      at: parseBatchDate(id),
      count: list.length,
      accounts: [...accounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      total,
      firstDate,
      lastDate,
      ids: list.map((t) => t.id),
      sample: list.slice(0, 3).map((t) => t.description),
    });
  }

  // Mais recente primeiro: o lote que acabou de dar errado é o que se procura.
  return out.sort((a, b) => {
    const ta = a.at?.getTime() ?? 0;
    const tb = b.at?.getTime() ?? 0;
    return tb - ta;
  });
}

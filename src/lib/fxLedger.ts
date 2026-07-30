/**
 * fxLedger — apreçamento em BRL de gastos feitos em moeda estrangeira, por
 * FIFO sobre os lotes de compra da moeda.
 *
 * ── O problema ─────────────────────────────────────────────────────────────
 * Um extrato de conta em moeda estrangeira (Wise e afins) vem TODO na moeda
 * da conta. Para o gasto entrar nos totais do app — que são em BRL — é
 * preciso dizer quanto cada euro gasto CUSTOU. E o custo não é a cotação do
 * dia: é o que você efetivamente pagou ao comprar aquele euro, com IOF e
 * spread embutidos. No caso real que motivou este módulo a diferença era de
 * 4,1% (efetiva 6,0481 contra mid-market 5,81) — usar cotação subestimaria a
 * viagem inteira em mais de mil reais.
 *
 * ── A regra: FIFO por lote ─────────────────────────────────────────────────
 * Cada conversão BRL → moeda cria um LOTE (quanto de moeda entrou, por quanto
 * em BRL). Cada gasto consome os lotes na ordem em que foram comprados, e o
 * custo em BRL do gasto é a soma do que ele consumiu de cada lote. É a mesma
 * contabilidade de estoque de qualquer bem fungível, e é exata: a soma dos
 * custos de todos os gastos mais o custo do saldo remanescente bate,
 * centavo a centavo, com o total desembolsado em BRL.
 *
 * Preferimos FIFO à taxa média ponderada porque o extrato é importado em
 * PEDAÇOS (um por mês). Com taxa média, cada importação recalcularia o custo
 * da anterior e os meses já fechados mudariam de valor a cada arquivo novo.
 * Com FIFO, o que já foi apreçado está apreçado — o que atravessa a fronteira
 * entre extratos é só o `FxCarry` abaixo.
 *
 * ── O carry-over (`FxCarry`) ───────────────────────────────────────────────
 * Todo extrato começa com um saldo que sobrou do anterior. Em moeda o valor
 * está no próprio arquivo (`Running Balance`), mas o CUSTO em BRL desse saldo
 * só existe no histórico. É o único dado que precisa atravessar importações —
 * por isso é um parâmetro de entrada e um resultado de saída, e o app o
 * guarda entre uma importação e a seguinte (ver `useFxWallets`).
 *
 * Sem carry-over declarado (primeira importação de quem já tinha saldo), o
 * módulo NÃO inventa: apreça o excedente pela taxa média das conversões do
 * próprio arquivo e reporta o tamanho do buraco em `uncoveredFx`, para a tela
 * avisar em vez de mostrar um número errado com cara de exato.
 *
 * ── Aritmética ─────────────────────────────────────────────────────────────
 * Tudo em CENTAVOS INTEIROS (moeda e BRL). Rateio de lote parcial arredonda
 * uma vez, e o consumo do último pedaço de um lote leva o resto exato do
 * saldo daquele lote — assim não sobra poeira de arredondamento nem falta
 * centavo no fechamento. Nada de floats acumulando erro ao longo de centenas
 * de lançamentos.
 */

import type { WiseEntry } from './parseWiseStatement';

/** Saldo de moeda e o que ele custou em BRL. Atravessa importações. */
export interface FxCarry {
  /** Saldo na moeda da conta (ex.: 1174.66 EUR). */
  balanceFx: number;
  /** Quanto esse saldo custou, em BRL. */
  costBrl: number;
  /** `true` quando esse custo não é o desembolso real e sim uma estimativa —
   *  o saldo veio de um extrato importado sem o custo de abertura declarado.
   *  A marca ATRAVESSA importações: sem ela, o extrato seguinte apresentaria
   *  como exato um valor que herdou uma base estimada, e a estimativa
   *  desapareceria da vista justamente por ter ficado velha. */
  estimated?: boolean;
}

/** Um lançamento do extrato já com preço em BRL. */
export interface FxPricedEntry {
  entry: WiseEntry;
  /** Valor em BRL, assinado no mesmo sentido de `entry.amountFx`
   *  (negativo = despesa). Para conversões de entrada é o BRL desembolsado,
   *  negativo — a saída da conta corrente que comprou a moeda. */
  amountBrl: number;
  /** Custo unitário efetivo aplicado (BRL por unidade de moeda), ou `null`
   *  quando o valor é zero. Só para exibição/conferência. */
  rate: number | null;
  /** `true` quando parte do valor foi apreçada pela taxa média de fallback
   *  por falta de lote — o número é estimado, não exato. */
  estimated: boolean;
}

export interface FxLedgerResult {
  /** Gastos e créditos (tudo que NÃO é compra de moeda), em ordem
   *  cronológica — as linhas que viram despesa no app. */
  movements: FxPricedEntry[];
  /** As compras de moeda, apreçadas pelo BRL efetivamente desembolsado. */
  conversions: FxPricedEntry[];
  /** Saldo e custo no fim do período — o carry-over da PRÓXIMA importação. */
  closing: FxCarry;
  /** Taxa média ponderada das conversões deste arquivo (BRL por unidade de
   *  moeda), ou `null` se não houve conversão. Só informativa. */
  averageRate: number | null;
  /** Quanto de moeda foi gasto sem lote que a lastreasse (saldo de abertura
   *  não declarado). Zero = apreçamento 100% exato. */
  uncoveredFx: number;
  /** Taxa usada para apreçar `uncoveredFx`. `null` quando não houve buraco
   *  ou quando não havia nenhuma conversão de onde tirar uma média — neste
   *  segundo caso o buraco ficou apreçado a ZERO, e a tela deve BLOQUEAR a
   *  importação em vez de gravar lançamentos de R$ 0,00. */
  fallbackRate: number | null;
}

interface Lot {
  /** Moeda restante no lote, em centavos. */
  fx: number;
  /** Custo restante do lote, em centavos de BRL. */
  brl: number;
  /** `true` quando o custo do lote não veio de uma compra de moeda real e sim
   *  da taxa média (saldo de abertura sem custo declarado). Contamina quem
   *  consome o lote: um gasto lastreado por custo estimado é, ele próprio,
   *  estimado — sem isso a linha se apresentaria como exata. */
  estimated?: boolean;
}

const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/**
 * Apreça os lançamentos de um extrato.
 *
 * @param entries  saída de `parseWiseStatement`, em ordem cronológica crescente
 *                 (o FIFO depende disso: um gasto nunca pode consumir um lote
 *                 comprado depois dele).
 * @param opening  saldo/custo herdado do extrato anterior. `balanceFx` sai do
 *                 próprio arquivo (`meta.openingBalance`); `costBrl` vem do
 *                 histórico guardado ou do que o usuário informar. Zerado na
 *                 primeira importação de uma conta nova.
 */
export function buildFxLedger(entries: WiseEntry[], opening: FxCarry): FxLedgerResult {
  // Taxa de fallback: média ponderada das conversões DESTE arquivo. Calculada
  // antes do laço porque um gasto pode precisar dela logo na primeira linha
  // (saldo de abertura sem custo declarado), antes de qualquer conversão.
  let convFx = 0;
  let convBrl = 0;
  for (const e of entries) {
    if (e.isConversion && e.sourceAmount !== null) {
      convFx += toCents(e.amountFx);
      convBrl += toCents(e.sourceAmount);
    }
  }
  const averageRate = convFx > 0 ? convBrl / convFx : null;

  const openingFx = toCents(opening.balanceFx);
  const openingBrl = toCents(opening.costBrl);
  // Saldo de abertura declarado sem custo: apreçamos pela média do arquivo e
  // marcamos o buraco. Melhor um número aproximado E sinalizado do que travar
  // a importação inteira — a tela mostra o aviso e o usuário decide.
  const openingCovered = openingFx > 0 && openingBrl > 0;
  const lots: Lot[] = [];
  if (openingFx > 0) {
    lots.push({
      fx: openingFx,
      brl: openingCovered ? openingBrl : (averageRate !== null ? Math.round(openingFx * averageRate) : 0),
      estimated: !openingCovered || opening.estimated === true,
    });
  }

  const movements: FxPricedEntry[] = [];
  const conversions: FxPricedEntry[] = [];
  // Saldo de abertura sem custo declarado JÁ é buraco, mesmo que a média do
  // arquivo tape o valor — o número sai estimado e a tela precisa dizer isso.
  // Contar aqui não duplica com o `shortFx` do consumo: quando existe lote de
  // abertura (ainda que apreçado pela média), o consumo não relata falta.
  let uncoveredFx = openingCovered ? 0 : openingFx;

  for (const entry of entries) {
    const fxCents = toCents(entry.amountFx);

    if (entry.isConversion) {
      // Compra de moeda: cria lote e sai da conta corrente em BRL.
      const costCents = entry.sourceAmount !== null
        ? toCents(entry.sourceAmount)
        : (averageRate !== null ? Math.round(fxCents * averageRate) : 0);
      // Custo derivado da cotação mid-market (recarga sem o valor em BRL no
      // arquivo) é aproximação por baixo: o lote nasce marcado, e a marca
      // acompanha cada gasto que consumir dele.
      const approx = entry.sourceAmount === null || entry.sourceEstimated === true;
      lots.push({ fx: fxCents, brl: costCents, estimated: approx });
      conversions.push({
        entry,
        amountBrl: -fromCents(costCents),
        rate: fxCents > 0 ? costCents / fxCents : null,
        estimated: approx,
      });
      continue;
    }

    if (fxCents < 0) {
      // Gasto: consome os lotes mais antigos primeiro.
      const { costCents, estimated, shortFx } = consume(lots, -fxCents, averageRate);
      uncoveredFx += shortFx;
      movements.push({
        entry,
        amountBrl: -fromCents(costCents),
        rate: costCents > 0 ? costCents / -fxCents : null,
        estimated,
      });
      continue;
    }

    // Crédito avulso (estorno que a Wise emitiu com id próprio, cashback,
    // dinheiro recebido). Volta ao estoque pelo custo médio do que está lá —
    // usar a cotação do dia criaria lucro/prejuízo de câmbio fantasma, que
    // este app não modela. Sem estoque, cai na média do arquivo.
    const stockRate = currentAverage(lots);
    const rate = stockRate ?? averageRate;
    const costCents = rate !== null ? Math.round(fxCents * rate) : 0;
    lots.push({ fx: fxCents, brl: costCents, estimated: stockRate === null || lots.some((l) => l.estimated) });
    movements.push({
      entry,
      amountBrl: fromCents(costCents),
      rate: fxCents > 0 ? costCents / fxCents : null,
      // Só é estimativa quando não havia estoque de onde tirar o custo real.
      estimated: stockRate === null,
    });
  }

  const restFx = lots.reduce((s, l) => s + l.fx, 0);
  const restBrl = lots.reduce((s, l) => s + l.brl, 0);

  return {
    movements,
    conversions,
    closing: {
      balanceFx: fromCents(restFx),
      costBrl: fromCents(restBrl),
      // Só o que SOBROU importa: se os lotes estimados já foram todos
      // gastos, o saldo que atravessa é de compras reais e volta a ser exato.
      estimated: lots.some((l) => l.estimated),
    },
    averageRate,
    uncoveredFx: fromCents(uncoveredFx),
    fallbackRate: uncoveredFx > 0 ? averageRate : null,
  };
}

/**
 * Consome `needFx` centavos de moeda dos lotes mais antigos e devolve o custo
 * em centavos de BRL.
 *
 * O lote consumido POR INTEIRO entrega o saldo exato que ainda tinha (nunca
 * um valor rateado) — é isso que garante que a soma dos custos feche com o
 * desembolso total sem sobra de centavo. Só o consumo PARCIAL rateia, e aí o
 * arredondamento é descontado do lote para o resto continuar coerente.
 */
function consume(
  lots: Lot[],
  needFx: number,
  fallbackRate: number | null
): { costCents: number; estimated: boolean; shortFx: number } {
  let remaining = needFx;
  let cost = 0;
  let estimated = false;

  while (remaining > 0 && lots.length > 0) {
    const lot = lots[0];
    if (lot.estimated) estimated = true;
    if (lot.fx <= remaining) {
      cost += lot.brl;
      remaining -= lot.fx;
      lots.shift();
    } else {
      const share = Math.round((lot.brl * remaining) / lot.fx);
      cost += share;
      lot.brl -= share;
      lot.fx -= remaining;
      remaining = 0;
    }
  }

  if (remaining > 0) {
    // Gastou moeda que nenhum lote conhecido lastreia. Acontece quando a
    // conta já tinha saldo e o custo dele não foi informado.
    if (fallbackRate !== null) cost += Math.round(remaining * fallbackRate);
    estimated = true;
  }

  return { costCents: cost, estimated, shortFx: remaining };
}

/** Custo médio do estoque atual (BRL por unidade de moeda), ou `null`. */
function currentAverage(lots: Lot[]): number | null {
  const fx = lots.reduce((s, l) => s + l.fx, 0);
  if (fx <= 0) return null;
  return lots.reduce((s, l) => s + l.brl, 0) / fx;
}

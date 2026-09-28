/**
 * Critérios de duplicata da importação.
 *
 * Saíram do `ImportModal` SEM mudança de comportamento para que qualquer
 * outro caminho de importação rode exatamente o mesmo código que a tela — uma
 * segunda cópia destas regras divergiria em silêncio, e um critério de
 * duplicata que diverge some com lançamentos sem erro visível. A tabela de
 * qual critério vale para qual origem está no `CLAUDE.md` ("Importação").
 *
 * O comportamento está fixado em `tests/import/` (golden tirado do master
 * antes da extração).
 */
import type { Transaction } from '../types';
import type { ImportItem, ImportRow } from './importTypes';
import { normalizeDescriptionForDedup } from './utils';

export function datesMatch(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.toDateString() === b.toDateString();
}

/** Casa se QUALQUER par de datas alinhar — cobre o caso em que um lado guarda
 *  a data da fatura e o outro a data da compra original. */
export function anyDatePairMatches(t: Transaction, item: ImportItem): boolean {
  return (
    datesMatch(t.date, item.date) ||
    datesMatch(t.purchaseDate, item.purchaseDate) ||
    datesMatch(t.date, item.purchaseDate) ||
    datesMatch(t.purchaseDate, item.date)
  );
}

/** Identidade da PARCELA. Duas linhas com a mesma descrição, mesmo valor e
 *  mesma data de compra ainda são cobranças DIFERENTES quando são parcelas
 *  diferentes do mesmo carnê — e é exatamente o que a fatura mostra: o banco
 *  repete a DATA DA COMPRA ORIGINAL em toda parcela seguinte, então a "Parcela
 *  5 de 6" de agosto é idêntica à "Parcela 4 de 6" de julho em tudo, menos no
 *  número da parcela. Era o que faltava olhar: sem isso o importador marcava as
 *  parcelas do mês como duplicata da fatura anterior, elas entravam
 *  DESMARCADAS e a fatura fechava abaixo do que o banco cobrou. */
export function installmentKey(t: Pick<Transaction, 'installmentNumber' | 'totalInstallments'>): string {
  if (t.installmentNumber == null || t.totalInstallments == null) return '';
  return `${t.installmentNumber}/${t.totalInstallments}`;
}

/** Núcleo comparável da descrição: só letras e dígitos, sem marcador de
 *  parcela. Espaço, pontuação e asterisco variam a cada leitura e não
 *  distinguem nada ("ZIG*ZIGPAY" e "Zig* *Zigpay" são o mesmo lugar). */
export function descriptionCore(desc: string): string {
  return normalizeDescriptionForDedup(desc).replace(/[^a-z0-9]/g, '');
}

/** Núcleo mínimo para aceitar casamento por truncamento. Abaixo disso o
 *  prefixo é curto demais e casaria estabelecimentos diferentes. */
export const DESC_CORE_MIN = 6;

/** Descrições compatíveis: iguais, ou uma é o começo da outra. O extrato trunca
 *  o nome do estabelecimento em larguras diferentes conforme a seção
 *  ("ELUBEL INDUSTRIA" na lista de compras, "Elubel Industria Ecotia" na de
 *  parcelados), então exigir igualdade byte a byte fazia o dedupe não
 *  reconhecer a própria linha já importada. */
export function descriptionsCompatible(a: string, b: string): boolean {
  const ca = descriptionCore(a);
  const cb = descriptionCore(b);
  if (!ca || !cb) return ca === cb;
  if (ca === cb) return true;
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  return short.length >= DESC_CORE_MIN && long.startsWith(short);
}

/** Contas compatíveis: iguais, ou ao menos uma indefinida. Exigir igualdade
 *  quando as duas estão preenchidas impede que um lançamento de um cartão seja
 *  tratado como duplicata de outro cartão com o mesmo valor e data; aceitar o
 *  lado vazio preserva o fallback do OFX, onde a linha pode vir sem conta. */
export function accountsCompatible(a: string, b: string): boolean {
  if (!a || !b) return true;
  return a === b;
}

/** Casamento para EXTRATO (conta corrente): data + valor + descrição, agora
 *  também exigindo conta e parcela compatíveis. A parcela só desempata quando
 *  os DOIS lados a declaram — num extrato ela costuma vir ausente, e tratar
 *  ausente como diferente faria toda reimportação duplicar. */
export function statementLineMatches(item: ImportItem, t: Transaction): boolean {
  if (Math.abs(t.amount - item.amount) >= 0.01) return false;
  if (!accountsCompatible(t.account, item.account)) return false;
  const kt = installmentKey(t);
  const ki = installmentKey(item);
  if (kt && ki && kt !== ki) return false;
  if (!descriptionsCompatible(t.description, item.description)) return false;
  return anyDatePairMatches(t, item);
}

/** Casamento para FATURA DE CARTÃO. A chave natural da linha é conta + data da
 *  compra + valor + parcela. A DESCRIÇÃO FICA FORA de propósito: é o único
 *  campo que a leitura por IA transcreve de formas diferentes a cada
 *  importação ("BRAZL COMERCIO DE AL" e "Brazrio Comercio De Al" são a mesma
 *  cobrança), e foi por exigir descrição idêntica que o dedupe deixou passar
 *  duplicatas reais numa segunda importação da mesma fatura. Uma compra tem uma
 *  data só e cada parcela tem número próprio — isso identifica a linha sem
 *  depender de como o texto saiu. Repetição legítima no mesmo dia (duas
 *  passagens de metrô de R$ 7,90) é resolvida pela CONTAGEM em
 *  `markDuplicates`, não pela descrição. */
export function invoiceLineMatches(item: ImportItem, t: Transaction): boolean {
  if (Math.abs(t.amount - item.amount) >= 0.01) return false;
  if (!accountsCompatible(t.account, item.account)) return false;
  if (installmentKey(t) !== installmentKey(item)) return false;

  // Numa fatura, a data que identifica a cobrança é a DATA DA COMPRA, e só ela.
  // O `date` de um lançamento de cartão guarda o VENCIMENTO da fatura — igual
  // para todas as linhas do mês —, então cruzar um com o outro (o que
  // `anyDatePairMatches` faz) compara coisas de naturezas diferentes: uma
  // compra feita no dia 20/08 casava com qualquer lançamento de mesmo valor da
  // fatura que venceu em 20/08. Com a descrição fora do critério, nada segurava
  // isso: na fatura de 09/2026, "Uber" de 20/08 virou duplicata de "GOOGLE ONE"
  // e "Indigo" virou duplicata de "GEPARK", só por coincidirem no valor.
  if (t.purchaseDate && item.purchaseDate) return datesMatch(t.purchaseDate, item.purchaseDate);

  // Sem data de compra de um dos lados (lançamento antigo ou digitado à mão)
  // resta o `date`, que é fraco demais sozinho — aqui a descrição volta como
  // trava, no lugar da precisão que falta.
  return datesMatch(t.date, item.date) && descriptionsCompatible(t.description, item.description);
}

/**
 * A categoria que as parcelas ANTERIORES deste mesmo carnê já receberam.
 *
 * Uma compra parcelada chega picada: cada fatura traz uma parcela, e cada uma
 * entra como lançamento novo. Sem isto, o usuário categoriza "Airbnb" em julho
 * e a parcela seguinte volta sem categoria em agosto — e de novo em setembro,
 * por seis meses. As 16 parcelas recuperadas na fatura de 08/2026 vieram todas
 * assim, e todas as 16 tinham parcela anterior já categorizada.
 *
 * O carnê é identificável com precisão porque o banco repete a DATA DA COMPRA
 * ORIGINAL em toda parcela: `conta + data da compra + valor + total de
 * parcelas` isola a compra, e o número da parcela ordena. (É a mesma
 * propriedade que `invoiceLineMatches` usa para o dedupe.)
 *
 * Só serve de RESERVA: roda quando nenhuma regra casou. E quando as parcelas
 * anteriores discordam entre si — duas compras distintas de mesmo valor, mesma
 * data e mesmo parcelamento existem (dois carnês de R$ 83,64 em 20/10/2025) —
 * devolve `null` em vez de chutar; a linha fica sem categoria, como antes.
 */
export function categoryFromPreviousInstallment(item: ImportItem, existing: Transaction[]): string | null {
  if (item.installmentNumber == null || item.totalInstallments == null) return null;

  const anteriores = existing.filter(
    (t) =>
      t.categoryId &&
      t.totalInstallments === item.totalInstallments &&
      t.installmentNumber != null &&
      t.installmentNumber < item.installmentNumber! &&
      Math.abs(t.amount - item.amount) < 0.01 &&
      accountsCompatible(t.account, item.account) &&
      anyDatePairMatches(t, item)
  );
  if (anteriores.length === 0) return null;

  const categorias = new Set(anteriores.map((t) => t.categoryId));
  if (categorias.size > 1) return null;
  return anteriores[0].categoryId;
}

/**
 * Marca as duplicatas do lote CONTANDO ocorrências, em vez de perguntar
 * "existe alguma igual?".
 *
 * A fatura repete cobranças legítimas: duas passagens de metrô de R$ 7,90 no
 * mesmo dia são duas linhas, não erro de leitura. Com a pergunta de existência,
 * bastava UMA delas estar gravada para as DUAS serem marcadas — e a segunda
 * nunca entrava. Aqui cada transação já gravada explica NO MÁXIMO uma linha do
 * arquivo: as N primeiras de cada chave batem com as N que já existem, e o
 * excedente entra como novo.
 */
export function markDuplicates(
  items: ImportItem[],
  existing: Transaction[],
  matches: (item: ImportItem, t: Transaction) => boolean,
  via: NonNullable<ImportRow['duplicateOf']>['via']
): (ImportRow['duplicateOf'] | undefined)[] {
  const claimed = new Set<string>();
  return items.map((item) => {
    const hit = existing.find((t) => !claimed.has(t.id) && matches(item, t));
    if (!hit) return undefined;
    claimed.add(hit.id);
    return { account: hit.account, date: hit.date, description: hit.description, via };
  });
}

/** Devolve a transação que colide, ou `null`. Antes era um booleano — mas
 *  quem está olhando o preview precisa saber CONTRA O QUÊ bateu. */
export function findDuplicate(item: ImportItem, existing: Transaction[]): Transaction | null {
  return existing.find((t) => statementLineMatches(item, t)) ?? null;
}

export function isDuplicate(item: ImportItem, existing: Transaction[]): boolean {
  return findDuplicate(item, existing) !== null;
}

// ─── OFX (conta corrente) — dedupe, encoding e auto-match de conta ─────────
//
// Irmão do caminho de IA acima: dedupe primeiro pelo FITID (chave natural do
// OFX, id estável emitido pelo próprio banco). FITID é único
// POR CONTA, não global (dois bancos podem emitir o mesmo FITID) — por isso só
// tratamos como duplicata quando a CONTA de destino também casa. Sem conta
// definida na linha OFX, ou sem match de conta, caímos no fallback por
// data+valor+descrição, que não corre esse risco de colisão entre contas.
export function isOfxDuplicate(item: ImportItem, existing: Transaction[]): boolean {
  if (item.fitid && item.account) {
    // Casa também pelo VALOR: alguns bancos (ex.: Banco do Brasil) reusam o
    // mesmo FITID em transações diferentes (todos os "Resgate CDB" com o mesmo
    // id). Sem o valor, um Resgate novo seria marcado como duplicata de outro
    // já importado. Duplicata real tem FITID, conta E valor iguais.
    const fitidMatch = existing.some(
      (t) => t.fitid === item.fitid && t.account === item.account && Math.abs(t.amount - item.amount) < 0.01
    );
    if (fitidMatch) return true;
  }
  return isDuplicate(item, existing);
}

/**
 * Dedupe do extrato em moeda estrangeira. Diferente do OFX de propósito: NÃO
 * entra o valor na comparação.
 *
 * O `TransferWise ID` é único por lançamento dentro da conta (ao contrário do
 * FITID, que alguns bancos reciclam), então id + conta já identificam a
 * transação com segurança. E o valor em BRL da MESMA transação pode mudar
 * legitimamente entre duas importações — ele é derivado do custo dos lotes de
 * câmbio (ver `fxLedger`), que se refina quando o carry-over da carteira é
 * informado. Exigir valor igual faria a reimportação de um período que se
 * sobrepõe ao anterior duplicar tudo, calada.
 */
export function findFxDuplicate(item: ImportItem, existing: Transaction[]): ImportRow['duplicateOf'] {
  if (item.fitid && item.account) {
    const byId = existing.find((t) => t.fitid === item.fitid && t.account === item.account);
    if (byId) return { account: byId.account, date: byId.date, description: byId.description, via: 'id' };
  }
  const byValue = findDuplicate(item, existing);
  if (byValue) {
    return { account: byValue.account, date: byValue.date, description: byValue.description, via: 'valor' };
  }
  return undefined;
}

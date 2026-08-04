import type { CategoryRule } from '../types';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Regras de categorização — o motor de casamento e o toggle do raio ⚡.
 *
 * Uma regra se prende SÓ à descrição do lançamento: não há vínculo com conta,
 * cartão, titular ou membro da família. `CategoryRule` é `{ pattern, keywords,
 * categoryId }`, e tudo aqui recebe uma string de descrição e devolve uma
 * categoria.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Forma canônica para comparar descrição e padrão. Extrato de banco é hostil:
 * vem em caixa alta, com acento inconsistente e espaço duplo colado por
 * concatenação. Sem normalizar, a regra "farmacia" não pega "FARMÁCIA SP" e
 * "uber *trip" não pega "UBER  *TRIP" — regras que o usuário criou e que
 * simplesmente não funcionam, sem explicação visível.
 *
 * É a mesma normalização que `syncCategories` já usa para casar NOMES de
 * categoria; o casamento de regras fazia só `.toLowerCase()`.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Casa um token (padrão ou palavra-chave) contra a descrição já normalizada e
 * devolve a ESPECIFICIDADE do casamento — o tamanho do texto que o token
 * realmente exige. `null` quando não casa.
 *
 * O tamanho é o que resolve a precedência: ver `findMatchingRule`.
 */
export function matchScore(normalizedDescription: string, rawToken: string): number | null {
  const token = normalizeForMatch(rawToken);
  const starts = token.startsWith('*');
  const ends = token.endsWith('*');
  // O needle é o token sem os curingas — é ele que mede a especificidade.
  const needle = token.slice(starts ? 1 : 0, ends ? -1 : undefined);
  // Token vazio (ou só "*") casaria com tudo e venceria por acidente de ordem.
  if (!needle) return null;

  let hit: boolean;
  if (starts && ends) hit = normalizedDescription.includes(needle);
  else if (starts) hit = normalizedDescription.endsWith(needle);
  else if (ends) hit = normalizedDescription.startsWith(needle);
  else hit = normalizedDescription.includes(needle);

  return hit ? needle.length : null;
}

export interface RuleMatch {
  rule: CategoryRule;
  /** O padrão ou a palavra-chave que casou — o que explicar ao usuário. */
  token: string;
  score: number;
}

/**
 * A regra MAIS ESPECÍFICA que cobre a descrição, ou `null`.
 *
 * Antes isto devolvia a PRIMEIRA que casasse, numa lista ordenada por
 * `orderBy('pattern')` — ou seja, a precedência era alfabética. Com as regras
 * "uber" → Transporte e "uber eats" → Alimentação, "UBER EATS 123" caía em
 * Transporte, porque "uber" vem antes no alfabeto e casa por substring. A regra
 * específica nunca pegava, e não havia como o usuário perceber por quê.
 *
 * Agora vence o casamento que exige mais texto ("uber eats" tem 9 caracteres
 * contra 4 de "uber"), que é o que "mais específica" significa na prática. Um
 * padrão idêntico à descrição vence naturalmente: nada pode exigir mais texto
 * do que a descrição inteira. Empate mantém a ordem da lista, para o resultado
 * ser estável entre renders.
 */
export function findMatchingRule(rules: CategoryRule[], description: string): RuleMatch | null {
  const normalized = normalizeForMatch(description);
  if (!normalized) return null;

  let best: RuleMatch | null = null;
  for (const rule of rules) {
    for (const token of [rule.pattern, ...(rule.keywords ?? [])]) {
      if (!token) continue;
      const score = matchScore(normalized, token);
      if (score !== null && (best === null || score > best.score)) {
        best = { rule, token, score };
      }
    }
  }
  return best;
}

/** Atalho para quem só quer a categoria: o caminho da importação. */
export function matchCategoryId(rules: CategoryRule[], description: string): string | null {
  return findMatchingRule(rules, description)?.rule.categoryId ?? null;
}

/**
 * Criar/remover a regra de categorização a partir de uma descrição — o
 * comportamento do raio ⚡ na tabela de lançamentos.
 *
 * É um TOGGLE, não um "criar": se já existe regra para aquela descrição, o
 * clique oferece REMOVER; senão, oferece criar. Estava escrito dentro da
 * `TransactionsPage`, e a aba Projetos passou a montar a mesma tabela — sem
 * extrair, o mesmo botão faria coisas diferentes dependendo da tela em que o
 * usuário clicasse, que é o pior tipo de inconsistência.
 *
 * A confirmação fica aqui de propósito: ela é parte da semântica da ação
 * (nada acontece sem o usuário confirmar), não decoração da tela.
 */
export async function toggleCategoryRule(
  deps: {
    rules: CategoryRule[];
    addRule: (data: Omit<CategoryRule, 'id' | 'createdAt'>) => Promise<void>;
    deleteRule: (id: string) => Promise<void>;
  },
  description: string,
  categoryId: string
): Promise<void> {
  // Mesma normalização do casamento: com `.toLowerCase()` puro, "Farmácia SP" e
  // "FARMACIA SP" eram padrões diferentes e o toggle criava a segunda regra.
  const target = normalizeForMatch(description);
  const existing = deps.rules.find((r) => normalizeForMatch(r.pattern) === target);
  if (existing) {
    const ok = window.confirm(`Já existe uma regra para "${description}".\n\nDeseja remover a regra?`);
    if (!ok) return;
    await deps.deleteRule(existing.id);
    return;
  }

  // Uma regra MAIS ABRANGENTE já pode cobrir esta descrição (a regra "uber"
  // cobre "UBER EATS 123"). Criar a específica continua valendo — e agora ela
  // vence, por ser mais específica —, mas o usuário precisa saber que está
  // criando uma exceção, e não uma regra para um caso ainda descoberto.
  const covering = findMatchingRule(deps.rules, description);
  const note = covering
    ? `\n\nA regra "${covering.token}" já cobre esta descrição. A nova é mais específica e passará a valer para ela.`
    : '';

  const ok = window.confirm(
    `Deseja criar uma regra para categorizar automaticamente transações com a descrição "${description}"?${note}`
  );
  if (!ok) return;
  await deps.addRule({ pattern: description, keywords: [], categoryId });
}

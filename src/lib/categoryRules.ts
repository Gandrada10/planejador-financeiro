import type { CategoryRule } from '../types';
import { extractTrailingInstallment } from './utils';

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
    // Pontuação vira ESPAÇO. A mesma cobrança sai com pontuação diferente
    // conforme a fonte — "DA CLARO BL/IT" no extrato da conta e
    // "DA  CLARO BL IT 36986725" na fatura; "REMUNERACAO/SALARIO" e
    // "REMUNERACAO SALARIO". Comparando com a pontuação, cada variante exigia a
    // SUA regra, e era daí que vinha a sensação de precisar recadastrar a mesma
    // regra para cada cartão ou conta. O separador vira espaço (e não nada) de
    // propósito: colar as palavras faria "bl/it" virar "blit" e casar dentro de
    // palavras maiores.
    .replace(/[^a-z0-9]+/g, ' ')
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
  // Os curingas são lidos no token CRU, antes de normalizar: a normalização
  // agora transforma pontuação em espaço, e o `*` da borda deixaria de ser
  // reconhecido como curinga — toda regra ancorada passaria a casar por
  // substring, silenciosamente.
  const trimmed = (rawToken ?? '').trim();
  const starts = trimmed.startsWith('*');
  const ends = trimmed.endsWith('*');
  // O needle é o token sem os curingas — é ele que mede a especificidade.
  const needle = normalizeForMatch(trimmed.slice(starts ? 1 : 0, ends ? -1 : undefined));
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
 * O padrão que a regra DEVERIA guardar, a partir de uma descrição de extrato.
 *
 * O ⚡ gravava a descrição INTEIRA como padrão, e o casamento exige que esse
 * texto apareça dentro do lançamento novo. Só que a descrição carrega o que
 * muda a cada cobrança — número da loja, CNPJ, data, marcador de parcela — e
 * cada fonte escreve o resto de um jeito. Resultado: a regra criada na fatura
 * do cartão não pegava o mesmo estabelecimento na conta corrente, e nascia uma
 * segunda regra para a mesma coisa. Numa base real isso virou 44 regras
 * redundantes em 161 — "PAG BOLETO PETIT COMITE - MABE SERVICOS EDUCACIONAIS
 * LTDA - 17.439.432/0001-04" e "PAG BOLETO PETIT COMITE" apontando para a mesma
 * categoria.
 *
 * O que sai: marcador de parcela no fim, o rabo depois do primeiro " - "
 * (razão social e documento), CPF/CNPJ e a cauda numérica. O que fica é o
 * núcleo do estabelecimento.
 *
 * Isto é uma SUGESTÃO, nunca uma imposição: quem cria a regra vê o texto e
 * edita. É essa revisão que protege os casos em que a cauda é justamente o que
 * distingue — "PIX TRANSF ANA LUI" (aluguel) e "PIX TRANSF ANA PAU"
 * (empregada) viram regras diferentes de propósito, e encurtar sozinho
 * juntaria as duas.
 */
export function suggestRulePattern(description: string): string {
  const semParcela = extractTrailingInstallment(description)?.description ?? description;
  const semRazaoSocial = semParcela.split(' - ')[0];
  const limpo = semRazaoSocial
    // CPF/CNPJ em qualquer posição.
    .replace(/\b\d{2,3}[.\d]*\/?\d{0,4}-\d{2}\b/g, ' ')
    // Cauda numérica: identificador de loja, data solta, sequência de contrato.
    .replace(/[\s*/-]*\b[\d./\s-]{2,}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Curto demais para ser um estabelecimento: a limpeza comeu o que importava,
  // então é mais seguro devolver a descrição como veio.
  return limpo.length >= 4 ? limpo : description.trim();
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

  // Campo EDITÁVEL com a sugestão já limpa, em vez de um sim/não sobre a
  // descrição crua. O padrão é o que decide se a regra vai valer nas outras
  // fontes, então ele precisa estar à vista e sob controle de quem cria.
  const sugestao = suggestRulePattern(description);
  const informado = window.prompt(
    `Criar regra de categorização.\n\n` +
      `Lançamento: "${description}"\n\n` +
      `A regra vale para QUALQUER conta ou cartão — ela casa pelo texto abaixo. ` +
      `Quanto mais curto, mais lançamentos ela cobre; mantenha o suficiente para ` +
      `não pegar outro estabelecimento.${note}`,
    sugestao
  );
  if (informado === null) return;
  const pattern = informado.trim();
  if (!pattern) return;

  // Depois da edição o padrão pode ter virado um que já existe — o toggle no
  // início só comparou a descrição crua.
  const jaExiste = deps.rules.find((r) => normalizeForMatch(r.pattern) === normalizeForMatch(pattern));
  if (jaExiste) {
    window.alert(`Já existe uma regra com o padrão "${jaExiste.pattern}". Nada foi criado.`);
    return;
  }

  await deps.addRule({ pattern, keywords: [], categoryId });
}

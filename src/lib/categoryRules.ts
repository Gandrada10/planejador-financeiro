import type { CategoryRule } from '../types';

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
  const existing = deps.rules.find((r) => r.pattern.toLowerCase() === description.toLowerCase());
  if (existing) {
    const ok = window.confirm(`Já existe uma regra para "${description}".\n\nDeseja remover a regra?`);
    if (!ok) return;
    await deps.deleteRule(existing.id);
    return;
  }
  const ok = window.confirm(
    `Deseja criar uma regra para categorizar automaticamente transações com a descrição "${description}"?`
  );
  if (!ok) return;
  await deps.addRule({ pattern: description, keywords: [], categoryId });
}

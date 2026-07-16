export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: 'receita' | 'despesa' | 'ambos';
  parentId: string | null;
  createdAt: Date;
  /**
   * Categoria de EXCLUSÃO-DE-TOTAL (ex.: "Transferência"). Quando `true`, as
   * transações dessa categoria NÃO entram em nenhum total de receita/despesa
   * nem no breakdown por categoria — são dinheiro trocando de bolso (pagamento
   * de fatura de cartão, PIX entre contas próprias), não gasto/ganho. A regra
   * é centralizada em `countsInTotals` (ver `lib/utils.ts`). É um campo
   * dedicado — NUNCA inferido pelo `name` — para que renomear a categoria não
   * quebre a exclusão. `undefined`/ausente = conta normalmente.
   */
  excludeFromTotals?: boolean;
}

export interface BillingCycle {
  id: string;
  accountId: string;
  monthYear: string; // "YYYY-MM"
  status: 'open' | 'closed';
  closedAt: Date | null;
  paidAmount?: number;
  paymentDate?: Date | null;
  createdAt: Date;
}

export interface CategoryRule {
  id: string;
  pattern: string;
  keywords: string[];
  categoryId: string;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  date: Date;
  purchaseDate: Date | null;
  description: string;
  amount: number;
  categoryId: string | null;
  account: string;
  familyMember: string;
  titular: string;
  installmentNumber: number | null;
  totalInstallments: number | null;
  cardNumber: string | null;
  projectId: string | null;
  /** Marca um valor POSITIVO como REEMBOLSO (recuperação de um gasto — ex.:
   *  amigos te pagam de volta ingressos comprados no seu cartão). Nos totais
   *  ele NÃO conta como receita: abate a despesa (contra-despesa), para o
   *  líquido refletir o seu custo real. Ver `isIncomeAmount`/`isExpenseAmount`
   *  em `src/lib/utils.ts`. */
  isReimbursement?: boolean;
  /** Id da DESPESA (transação) que este reembolso abate. Quando presente, os
   *  TOTAIS atribuem o abatimento ao MÊS DA DESPESA (Opção 1 — ancorar no mês
   *  da compra), não ao mês em que o dinheiro entrou. A LISTA continua no mês
   *  real. Ver `accountingDate`/`effectiveDate`. */
  reimbursementFor?: string | null;
  /** Marca uma DESPESA que você espera receber de volta mas ainda não chegou.
   *  Só sinalizador visual — não altera nenhum total. */
  awaitingReimbursement?: boolean;
  /** Categoria que a transação tinha ANTES de ser vinculada como reembolso
   *  (o vínculo sobrescreve a categoria com a da despesa abatida). Restaurada
   *  ao deixar de ser reembolso, para a transação voltar ao estado original. */
  reimbursementPrevCategoryId?: string | null;
  /** NÃO persistido (derivado em `useTransactions`). Data usada nos TOTAIS:
   *  para reembolso vinculado é a data da despesa abatida; senão a própria
   *  `date`. Use via `accountingDate(t)`; nunca para exibir/ordenar. */
  effectiveDate?: Date;
  tags: string[];
  notes: string;
  importBatch: string | null;
  reconciled: boolean;
  reconciledAt: Date | null;
  createdAt: Date;
  /**
   * Vínculo estável com a fatura/ciclo do cartão ("YYYY-MM" do mês de
   * pagamento no momento da importação). Sobrevive a mudanças de `date`
   * causadas pela baixa da fatura (pagamento em mês diferente do vencimento)
   * — é o que permite reabrir a fatura depois e achar de volta as transações
   * dela. `null`/ausente para transações não-cartão ou importadas antes deste
   * campo existir (sem migração retroativa).
   */
  billingMonth?: string | null;
  /**
   * Data de caixa provisória (vencimento previsto do cartão no mês da
   * fatura), gravada no momento da importação. Preservada intacta quando a
   * baixa sobrescreve `date` com a data real do pagamento; usada para
   * restaurar `date` ao reabrir a fatura. `null`/ausente fora do fluxo de
   * cartão ou em transações legadas — nesse caso o reopen recalcula a
   * provisória a partir do `dueDay` atual do cartão.
   */
  provisionalDate?: Date | null;
  /**
   * Chave natural de dedupe do parser OFX (tag `FITID` do arquivo). Presente
   * só em transações importadas via extrato OFX de conta corrente; `null`/
   * ausente nas demais origens (fatura de cartão via IA, manual).
   * Dedupe contra reimportação usa este campo (ver `ImportModal.tsx`).
   */
  fitid?: string | null;
}

export interface Account {
  id: string;
  name: string;
  type: 'corrente' | 'cartao' | 'beneficio' | 'poupanca' | 'investimento' | 'outro';
  bank: string;
  closingDay?: number;
  dueDay?: number;
  creditLimit?: number;
  createdAt: Date;
}

export interface TitularMapping {
  id: string;
  cardLastDigits: string;
  titularName: string;
  createdAt: Date;
}

export type CategorizationSessionStatus = 'active' | 'applied' | 'dismissed';

export interface CategorizationSession {
  id: string;
  userId: string;
  titularName: string;
  transactionIds: string[];
  categorizedCount: number;
  expiresAt: Date;
  createdAt: Date;
  status: CategorizationSessionStatus;
  monthFilter: string;
  accounts: string[];
  totalAmount: number;
  appliedAt: Date | null;
  appliedCount: number;
  lastActivityAt: Date | null;
  /** Ids das categorias mais usadas (histórico), para a grade de acesso rápido. */
  topCategoryIds: string[];
}

export interface CategorizationTransaction {
  id: string;
  transactionId: string;
  description: string;
  amount: number;
  date: Date;
  installmentNumber: number | null;
  totalInstallments: number | null;
  categoryId: string | null;
  notes: string;
  /** Categoria provável, pré-calculada na criação da sessão (regras + histórico). */
  suggestedCategoryId: string | null;
  /** Motivo legível da sugestão, ex.: "Você já categorizou assim". */
  suggestionReason: string | null;
  /**
   * Conta/cartão de origem (ex.: "Nubank •••• 4535"), copiada da transação
   * real na criação da sessão. `null` em sessões antigas (campo ausente na
   * subcoleção) — a UI degrada graciosamente e não mostra o chip.
   */
  account: string | null;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  status: 'active' | 'archived';
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
}

export interface Budget {
  id: string;
  categoryId: string;
  monthYear: string;
  limitAmount: number;
  createdAt: Date;
}

export interface FamilyMember {
  id: string;
  name: string;
  color: string;
}

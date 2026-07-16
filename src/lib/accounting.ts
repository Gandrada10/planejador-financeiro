import type { Transaction } from '../types';
import { isReimbursementTx } from './utils';

/**
 * Camada contábil dos TOTAIS. Uma transação vira 1+ "entries" — as fatias que
 * dashboard, relatórios, PDF e metas somam. É aqui (e só aqui) que vive a
 * regra de ancoragem de reembolso: cada alocação abate a despesa-alvo no MÊS
 * e na CATEGORIA dela; o restante não-alocado abate no próprio mês do
 * reembolso (equivalente ao antigo "marcar sem vincular").
 *
 * Herança numa entry de alocação:
 * - `date` e `categoryId` vêm da DESPESA-ALVO (é a ancoragem);
 * - `txDate` é sempre a data REAL do lançamento — exibição/ordenação de
 *   linhas de detalhe usa ela, nunca `date`;
 * - conta/membro/titular/projeto ficam os PRÓPRIOS do reembolso (paridade com
 *   o modelo antigo, que nunca os sobrescrevia).
 *
 * Consumidores continuam classificando com `isIncomeAmount`/`isExpenseAmount`
 * e filtrando com `countsInTotals` — os três aceitam o shape de
 * AccountingEntry. Filtros/cards de LISTA (tabela, fatura) seguem por
 * transação; entries são só para totais agregados.
 */
export interface AccountingEntry {
  /** Único e estável (`txId` ou `txId:i` / `txId:rest`) — serve de key. */
  id: string;
  txId: string;
  /** Data CONTÁBIL — agrupa os totais por mês. */
  date: Date;
  /** Data REAL do lançamento — para exibir/ordenar linhas de detalhe. */
  txDate: Date;
  amount: number;
  isReimbursement: boolean;
  categoryId: string | null;
  account: string;
  familyMember: string;
  titular: string;
  projectId: string | null;
  description: string;
  notes: string;
  installmentNumber: number | null;
  totalInstallments: number | null;
}

/** Comparações/somas monetárias SEMPRE em centavos — resíduo de float
 *  (0.1 + 0.2) viraria falso "resto" de alocação ou falso bloqueio. */
export function toCents(v: number): number {
  return Math.round(v * 100);
}

function baseEntry(t: Transaction): AccountingEntry {
  return {
    id: t.id,
    txId: t.id,
    date: t.date,
    txDate: t.date,
    amount: t.amount,
    isReimbursement: !!t.isReimbursement,
    categoryId: t.categoryId,
    account: t.account,
    familyMember: t.familyMember,
    titular: t.titular,
    projectId: t.projectId,
    description: t.description,
    notes: t.notes,
    installmentNumber: t.installmentNumber,
    totalInstallments: t.totalInstallments,
  };
}

/**
 * Expande transações em entries contábeis. Invariante: para uma transação não
 * sobre-alocada, a soma dos `amount` das suas entries é igual ao `amount`
 * dela — os totais globais não mudam, só a distribuição por mês/categoria.
 */
export function toAccountingEntries(transactions: Transaction[]): AccountingEntry[] {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const entries: AccountingEntry[] = [];
  for (const t of transactions) {
    const allocations = isReimbursementTx(t) ? (t.reimbursementAllocations ?? []) : [];
    if (allocations.length === 0) {
      entries.push(baseEntry(t));
      continue;
    }
    // Alvo apagado: a fatia dele não é emitida e o valor volta para o resto
    // (abate no próprio mês) — nada some do total.
    let allocatedCents = 0;
    allocations.forEach((a, i) => {
      const target = byId.get(a.expenseId);
      if (!target) return;
      allocatedCents += toCents(a.amount);
      entries.push({
        ...baseEntry(t),
        id: `${t.id}:${i}`,
        amount: a.amount,
        date: target.date,
        categoryId: target.categoryId,
      });
    });
    const restCents = toCents(t.amount) - allocatedCents;
    // Sobre-alocação (valor editado depois das alocações) nunca vira resto
    // NEGATIVO: as fatias valem como estão e a UI sinaliza o excesso.
    if (restCents > 0) {
      entries.push({ ...baseEntry(t), id: `${t.id}:rest`, amount: restCents / 100 });
    }
  }
  return entries;
}

export interface ReimbursementSource {
  txId: string;
  amount: number;
  description: string;
  date: Date;
}

export interface ExpenseReimbursementSummary {
  /** Total já alocado (abatido) nesta despesa, em reais. */
  allocated: number;
  sources: ReimbursementSource[];
}

/**
 * Visão REVERSA: para cada despesa, quanto já foi abatido e por quais
 * reembolsos. Alimenta os chips "R$X de R$Y", o saldo das candidatas no
 * editor de alocações e a validação de bloqueio.
 */
export function reimbursementSummaryByExpense(
  transactions: Transaction[]
): Map<string, ExpenseReimbursementSummary> {
  const map = new Map<string, ExpenseReimbursementSummary>();
  for (const t of transactions) {
    if (!isReimbursementTx(t)) continue;
    for (const a of t.reimbursementAllocations ?? []) {
      let s = map.get(a.expenseId);
      if (!s) {
        s = { allocated: 0, sources: [] };
        map.set(a.expenseId, s);
      }
      s.allocated = (toCents(s.allocated) + toCents(a.amount)) / 100;
      s.sources.push({ txId: t.id, amount: a.amount, description: t.description, date: t.date });
    }
  }
  return map;
}

/**
 * Quanto do reembolso ainda NÃO foi alocado a despesa nenhuma, em reais.
 * Negativo = sobre-alocado (valor editado depois) — quem exibe clampa em zero
 * e sinaliza o excesso em vermelho.
 */
export function unallocatedReimbursementAmount(t: Transaction): number {
  const allocated = (t.reimbursementAllocations ?? []).reduce((s, a) => s + toCents(a.amount), 0);
  return (toCents(t.amount) - allocated) / 100;
}

/** Saldo AINDA reembolsável de uma despesa, em reais (clampado em ≥ 0). */
export function expenseRemaining(
  expense: Transaction,
  summary: Map<string, ExpenseReimbursementSummary>
): number {
  const allocated = summary.get(expense.id)?.allocated ?? 0;
  return Math.max(0, (toCents(Math.abs(expense.amount)) - toCents(allocated)) / 100);
}

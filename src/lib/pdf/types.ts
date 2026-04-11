import type { Transaction, Category, Budget, Account, Project } from '../../types';

/** Period scope for the consolidated report. */
export type ReportPeriod =
  | { kind: 'month'; monthYear: string }
  | { kind: 'quarter'; year: number; quarter: 1 | 2 | 3 | 4 }
  | { kind: 'year'; year: number }
  | { kind: 'custom'; startMonth: string; endMonth: string };

/** Period resolved to concrete boundaries + human label. */
export interface ResolvedPeriod {
  kind: ReportPeriod['kind'];
  label: string;
  months: string[]; // chronological "YYYY-MM"
  startMonth: string;
  endMonth: string;
}

/** Inputs for computing report data. */
export interface ReportDeps {
  transactions: Transaction[];
  categories: Category[];
  rootCategories: Category[];
  subCategories: (parentId: string) => Category[];
  budgets: Budget[];
  accounts: Account[];
  projects: Project[];
}

export interface KpiSummary {
  totalEntries: number;
  totalExits: number;
  totalBalance: number;
  ytdBalance: number;
  avg12Months: number;
  savingsRate: number; // 0..1 (net / entries)
  transactionCount: number;
  monthsCount: number;
}

export interface CashFlowByAccount {
  accountName: string;
  entries: number;
  exits: number;
  balance: number;
  isCard: boolean;
}

export interface ExpenseCategoryBreakdown {
  name: string;
  color: string;
  amount: number; // negative
  percentage: number;
  subs: Array<{
    name: string;
    color: string;
    amount: number;
    percentage: number;
  }>;
}

export interface BudgetProgress {
  categoryName: string;
  limit: number;
  actual: number; // spent (positive)
  pct: number; // 0..100+
  over: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  color: string;
  spent: number;
  income: number;
  balance: number;
  count: number;
}

export interface ReportCategoryGroup {
  label: string;
  color: string;
  total: number;
  percentage: number;
  subs: Array<{
    label: string;
    color: string;
    total: number;
    percentage: number;
    transactions: Array<{
      date: Date;
      description: string;
      amount: number;
      account: string;
      titular: string;
      installmentNumber: number | null;
      totalInstallments: number | null;
    }>;
  }>;
}

export interface CashFlowRow {
  monthYear: string;
  label: string;
  entradas: number;
  saidas: number;
  resultado: number;
  saldo: number;
}

export interface EvolutionRow {
  id: string;
  label: string;
  color: string;
  monthTotals: Record<string, number>;
  total: number;
  average: number;
  subs?: EvolutionRow[];
}

export interface InsightsData {
  topExpenses: Array<{ name: string; color: string; amount: number; pct: number }>;
  monthlyResult: Array<{ month: string; label: string; entradas: number; saidas: number; resultado: number }>;
  topExpenseTrend: Array<{ month: string; label: string } & Record<string, number | string>>;
  trendCategories: Array<{ name: string; color: string }>;
  callouts: string[];
}

export interface ReportData {
  period: ResolvedPeriod;
  kpis: KpiSummary;
  dashboard: {
    cashFlowByAccount: CashFlowByAccount[];
    expensesByCategory: ExpenseCategoryBreakdown[];
    budgets: BudgetProgress[];
    budgetTotalLimit: number;
    budgetTotalActual: number;
    projects: ProjectSummary[];
  };
  byCategory: {
    groups: ReportCategoryGroup[];
    totalEntries: number;
    totalExits: number;
    totalBalance: number;
  };
  cashFlow: {
    rows: CashFlowRow[];
    saldoAnterior: number;
    totalEntradas: number;
    totalSaidas: number;
  };
  evolution: {
    months: string[];
    monthLabels: string[];
    incomeRows: EvolutionRow[];
    expenseRows: EvolutionRow[];
    sectionTotals: { receitas: Record<string, number>; despesas: Record<string, number> };
  };
  insights: InsightsData;
}

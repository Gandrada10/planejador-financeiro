export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: 'receita' | 'despesa' | 'ambos';
  createdAt: Date;
}

export interface CategoryRule {
  id: string;
  pattern: string;
  categoryId: string;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  date: Date;
  description: string;
  amount: number;
  categoryId: string | null;
  account: string;
  familyMember: string;
  tags: string[];
  notes: string;
  importBatch: string | null;
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

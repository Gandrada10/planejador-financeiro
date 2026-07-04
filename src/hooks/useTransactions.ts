import { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { Transaction } from '../types';
import { normalizeTitular } from '../lib/utils';

function getUserTransactionsRef() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  return collection(db, 'users', uid, 'transactions');
}

// Firestore limita um writeBatch a 500 operações. Commit em blocos de 400 para
// que importações/edições grandes (fatura extensa, "selecionar tudo") não
// estourem o limite e falhem por inteiro.
const BATCH_CHUNK = 400;

async function commitInChunks<T>(items: T[], apply: (batch: ReturnType<typeof writeBatch>, item: T) => void) {
  for (let i = 0; i < items.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    for (const item of items.slice(i, i + BATCH_CHUNK)) apply(batch, item);
    await batch.commit();
  }
}

function docToTransaction(id: string, data: Record<string, unknown>): Transaction {
  return {
    id,
    date: (data.date as Timestamp).toDate(),
    description: (data.description as string) || '',
    amount: (data.amount as number) || 0,
    categoryId: (data.categoryId as string) || null,
    account: (data.account as string) || '',
    familyMember: (data.familyMember as string) || '',
    titular: normalizeTitular((data.titular as string) || ''),
    purchaseDate: data.purchaseDate ? (data.purchaseDate as Timestamp).toDate() : null,
    installmentNumber: (data.installmentNumber as number) ?? null,
    totalInstallments: (data.totalInstallments as number) ?? null,
    cardNumber: (data.cardNumber as string) || null,
    projectId: (data.projectId as string) || null,
    pluggyTransactionId: (data.pluggyTransactionId as string) || null,
    tags: (data.tags as string[]) || [],
    notes: (data.notes as string) || '',
    importBatch: (data.importBatch as string) || null,
    reconciled: (data.reconciled as boolean) || false,
    reconciledAt: data.reconciledAt ? (data.reconciledAt as Timestamp).toDate() : null,
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
    billingMonth: (data.billingMonth as string) || null,
    provisionalDate: data.provisionalDate ? (data.provisionalDate as Timestamp).toDate() : null,
    fitid: (data.fitid as string) || null,
  };
}

export function useTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const ref = collection(db, 'users', uid, 'transactions');
    const q = query(ref, orderBy('date', 'desc'));

    return onSnapshot(q, (snap) => {
      setTransactions(snap.docs.map((d) => docToTransaction(d.id, d.data())));
      setLoading(false);
    });
  }, []);

  async function addTransaction(data: Omit<Transaction, 'id' | 'createdAt'>) {
    const ref = getUserTransactionsRef();
    await addDoc(ref, {
      ...data,
      titular: normalizeTitular(data.titular),
      date: Timestamp.fromDate(data.date),
      purchaseDate: data.purchaseDate ? Timestamp.fromDate(data.purchaseDate) : null,
      billingMonth: data.billingMonth ?? null,
      provisionalDate: data.provisionalDate ? Timestamp.fromDate(data.provisionalDate) : null,
      createdAt: Timestamp.now(),
    });
  }

  async function updateTransaction(id: string, data: Partial<Transaction>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'transactions', id);
    const updates: Record<string, unknown> = { ...data };
    if (data.titular !== undefined) updates.titular = normalizeTitular(data.titular);
    if (data.date) updates.date = Timestamp.fromDate(data.date);
    if (data.purchaseDate) updates.purchaseDate = Timestamp.fromDate(data.purchaseDate);
    if (data.provisionalDate) updates.provisionalDate = Timestamp.fromDate(data.provisionalDate);
    if (data.reconciledAt !== undefined) {
      updates.reconciledAt = data.reconciledAt ? Timestamp.fromDate(data.reconciledAt) : null;
    }
    delete updates.id;
    delete updates.createdAt;
    await updateDoc(ref, updates);
  }

  async function deleteTransaction(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'transactions', id));
  }

  async function importBatch(items: Omit<Transaction, 'id' | 'createdAt'>[]) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = collection(db, 'users', uid, 'transactions');
    const batchId = `import_${Date.now()}`;
    await commitInChunks(items, (batch, item) => {
      const newDoc = doc(ref);
      batch.set(newDoc, {
        ...item,
        titular: normalizeTitular(item.titular),
        date: Timestamp.fromDate(item.date),
        purchaseDate: item.purchaseDate ? Timestamp.fromDate(item.purchaseDate) : null,
        billingMonth: item.billingMonth ?? null,
        provisionalDate: item.provisionalDate ? Timestamp.fromDate(item.provisionalDate) : null,
        importBatch: batchId,
        createdAt: Timestamp.now(),
      });
    });
  }

  async function batchUpdateReconciled(ids: string[], reconciled: boolean) {
    const uid = auth.currentUser?.uid;
    if (!uid || ids.length === 0) return;
    const now = reconciled ? Timestamp.now() : null;
    await commitInChunks(ids, (batch, id) => {
      const ref = doc(db, 'users', uid, 'transactions', id);
      batch.update(ref, { reconciled, reconciledAt: now });
    });
  }

  async function batchUpdate(ids: string[], data: Partial<Transaction>) {
    const uid = auth.currentUser?.uid;
    if (!uid || ids.length === 0) return;
    const updates: Record<string, unknown> = { ...data };
    if (data.titular !== undefined) updates.titular = normalizeTitular(data.titular);
    if (data.date) updates.date = Timestamp.fromDate(data.date);
    if (data.purchaseDate) updates.purchaseDate = Timestamp.fromDate(data.purchaseDate);
    if (data.provisionalDate) updates.provisionalDate = Timestamp.fromDate(data.provisionalDate);
    if (data.reconciledAt !== undefined) {
      updates.reconciledAt = data.reconciledAt ? Timestamp.fromDate(data.reconciledAt) : null;
    }
    delete updates.id;
    delete updates.createdAt;
    await commitInChunks(ids, (batch, id) => {
      const ref = doc(db, 'users', uid, 'transactions', id);
      batch.update(ref, updates);
    });
  }

  /**
   * Como `batchUpdate`, mas cada id recebe seu PRÓPRIO objeto de dados (em vez
   * de um único `data` aplicado a todos). Usado no reopen de fatura (T3): cada
   * transação restaura sua própria `provisionalDate`, que pode variar
   * linha-a-linha (parcelas futuras, edições manuais pós-importação).
   */
  async function batchUpdateVarying(updates: { id: string; data: Partial<Transaction> }[]) {
    const uid = auth.currentUser?.uid;
    if (!uid || updates.length === 0) return;
    await commitInChunks(updates, (batch, u) => {
      const upd: Record<string, unknown> = { ...u.data };
      if (u.data.titular !== undefined) upd.titular = normalizeTitular(u.data.titular);
      if (u.data.date) upd.date = Timestamp.fromDate(u.data.date);
      if (u.data.purchaseDate) upd.purchaseDate = Timestamp.fromDate(u.data.purchaseDate);
      if (u.data.provisionalDate) upd.provisionalDate = Timestamp.fromDate(u.data.provisionalDate);
      if (u.data.reconciledAt !== undefined) {
        upd.reconciledAt = u.data.reconciledAt ? Timestamp.fromDate(u.data.reconciledAt) : null;
      }
      delete upd.id;
      delete upd.createdAt;
      const ref = doc(db, 'users', uid, 'transactions', u.id);
      batch.update(ref, upd);
    });
  }

  return { transactions, loading, addTransaction, updateTransaction, deleteTransaction, importBatch, batchUpdateReconciled, batchUpdate, batchUpdateVarying };
}

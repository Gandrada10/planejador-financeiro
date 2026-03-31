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

function getUserTransactionsRef() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  return collection(db, 'users', uid, 'transactions');
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
    tags: (data.tags as string[]) || [],
    notes: (data.notes as string) || '',
    importBatch: (data.importBatch as string) || null,
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
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
      date: Timestamp.fromDate(data.date),
      createdAt: Timestamp.now(),
    });
  }

  async function updateTransaction(id: string, data: Partial<Transaction>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'transactions', id);
    const updates: Record<string, unknown> = { ...data };
    if (data.date) updates.date = Timestamp.fromDate(data.date);
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
    const batch = writeBatch(db);
    const batchId = `import_${Date.now()}`;
    for (const item of items) {
      const newDoc = doc(ref);
      batch.set(newDoc, {
        ...item,
        date: Timestamp.fromDate(item.date),
        importBatch: batchId,
        createdAt: Timestamp.now(),
      });
    }
    await batch.commit();
  }

  return { transactions, loading, addTransaction, updateTransaction, deleteTransaction, importBatch };
}

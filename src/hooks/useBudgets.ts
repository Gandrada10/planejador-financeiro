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
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { Budget } from '../types';

function docToBudget(id: string, data: Record<string, unknown>): Budget {
  return {
    id,
    categoryId: (data.categoryId as string) || '',
    monthYear: (data.monthYear as string) || '',
    limitAmount: (data.limitAmount as number) || 0,
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
  };
}

export function useBudgets() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = collection(db, 'users', uid, 'budgets');
    return onSnapshot(query(ref, orderBy('monthYear', 'desc')), (snap) => {
      setBudgets(snap.docs.map((d) => docToBudget(d.id, d.data())));
      setLoading(false);
    });
  }, []);

  async function addBudget(data: Omit<Budget, 'id' | 'createdAt'>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await addDoc(collection(db, 'users', uid, 'budgets'), {
      ...data,
      createdAt: Timestamp.now(),
    });
  }

  async function updateBudget(id: string, data: Partial<Budget>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const { id: _, createdAt: __, ...update } = data;
    await updateDoc(doc(db, 'users', uid, 'budgets', id), update);
  }

  async function deleteBudget(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'budgets', id));
  }

  function getBudgetsForMonth(monthYear: string): Budget[] {
    return budgets.filter((b) => b.monthYear === monthYear);
  }

  return { budgets, loading, addBudget, updateBudget, deleteBudget, getBudgetsForMonth };
}

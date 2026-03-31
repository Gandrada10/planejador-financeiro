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
import type { BillingCycle } from '../types';
import { getMonthYear } from '../lib/utils';

function docToCycle(id: string, data: Record<string, unknown>): BillingCycle {
  return {
    id,
    accountId: (data.accountId as string) || '',
    monthYear: (data.monthYear as string) || '',
    status: (data.status as BillingCycle['status']) || 'open',
    closedAt: (data.closedAt as Timestamp)?.toDate() || null,
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
  };
}

export function useBillingCycles() {
  const [cycles, setCycles] = useState<BillingCycle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = collection(db, 'users', uid, 'billingCycles');
    return onSnapshot(query(ref, orderBy('monthYear', 'desc')), (snap) => {
      setCycles(snap.docs.map((d) => docToCycle(d.id, d.data())));
      setLoading(false);
    });
  }, []);

  async function createCycle(accountId: string, monthYear: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // Avoid duplicates
    if (cycles.find((c) => c.accountId === accountId && c.monthYear === monthYear)) return;
    await addDoc(collection(db, 'users', uid, 'billingCycles'), {
      accountId,
      monthYear,
      status: 'open',
      closedAt: null,
      createdAt: Timestamp.now(),
    });
  }

  async function closeCycle(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'billingCycles', id), {
      status: 'closed',
      closedAt: Timestamp.now(),
    });
  }

  async function reopenCycle(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'billingCycles', id), {
      status: 'open',
      closedAt: null,
    });
  }

  async function deleteCycle(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'billingCycles', id));
  }

  /** Returns the cycle for a given account + date, if it exists and is closed */
  function getClosedCycle(accountId: string, date: Date): BillingCycle | null {
    const monthYear = getMonthYear(date);
    return cycles.find(
      (c) => c.accountId === accountId && c.monthYear === monthYear && c.status === 'closed'
    ) ?? null;
  }

  /** Ensure a cycle exists for account + date (open by default) */
  async function ensureCycle(accountId: string, date: Date) {
    const monthYear = getMonthYear(date);
    if (!cycles.find((c) => c.accountId === accountId && c.monthYear === monthYear)) {
      await createCycle(accountId, monthYear);
    }
  }

  return { cycles, loading, createCycle, closeCycle, reopenCycle, deleteCycle, getClosedCycle, ensureCycle };
}

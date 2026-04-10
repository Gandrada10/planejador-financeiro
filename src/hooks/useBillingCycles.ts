import { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
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
    paidAmount: (data.paidAmount as number) || undefined,
    paymentDate: (data.paymentDate as Timestamp)?.toDate() || undefined,
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

  async function createCycle(accountId: string, monthYear: string): Promise<string | undefined> {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // Avoid duplicates
    const existing = cycles.find((c) => c.accountId === accountId && c.monthYear === monthYear);
    if (existing) return existing.id;
    const ref = await addDoc(collection(db, 'users', uid, 'billingCycles'), {
      accountId,
      monthYear,
      status: 'open',
      closedAt: null,
      createdAt: Timestamp.now(),
    });
    return ref.id;
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

  async function registerPayment(cycleId: string, amount: number, date: Date) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'billingCycles', cycleId), {
      paidAmount: amount,
      paymentDate: Timestamp.fromDate(date),
    });
  }

  function getCycleForCard(accountId: string, monthYear: string): BillingCycle | undefined {
    return cycles.find((c) => c.accountId === accountId && c.monthYear === monthYear);
  }

  /** Returns the cycle for a given account + date, if it exists and is closed */
  function getClosedCycle(accountId: string, date: Date): BillingCycle | null {
    const monthYear = getMonthYear(date);
    return cycles.find(
      (c) => c.accountId === accountId && c.monthYear === monthYear && c.status === 'closed'
    ) ?? null;
  }

  /** Ensure a cycle exists for account + date (open by default). Returns the cycle id. */
  async function ensureCycle(accountId: string, date: Date): Promise<string | undefined> {
    const monthYear = getMonthYear(date);
    const existing = cycles.find((c) => c.accountId === accountId && c.monthYear === monthYear);
    if (existing) return existing.id;
    return createCycle(accountId, monthYear);
  }

  return { cycles, loading, createCycle, closeCycle, reopenCycle, registerPayment, getCycleForCard, getClosedCycle, ensureCycle };
}

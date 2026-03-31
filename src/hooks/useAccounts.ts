import { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { Account } from '../types';

function docToAccount(id: string, data: Record<string, unknown>): Account {
  return {
    id,
    name: (data.name as string) || '',
    type: (data.type as Account['type']) || 'corrente',
    bank: (data.bank as string) || '',
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
  };
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const ref = collection(db, 'users', uid, 'accounts');
    return onSnapshot(query(ref, orderBy('name')), (snap) => {
      setAccounts(snap.docs.map((d) => docToAccount(d.id, d.data())));
      setLoading(false);
    });
  }, []);

  async function addAccount(data: Omit<Account, 'id' | 'createdAt'>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await addDoc(collection(db, 'users', uid, 'accounts'), {
      ...data,
      createdAt: Timestamp.now(),
    });
  }

  async function deleteAccount(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'accounts', id));
  }

  const accountNames = accounts.map((a) => a.name);

  return { accounts, accountNames, loading, addAccount, deleteAccount };
}

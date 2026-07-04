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
import type { Account } from '../types';

function docToAccount(id: string, data: Record<string, unknown>): Account {
  return {
    id,
    name: (data.name as string) || '',
    type: (data.type as Account['type']) || 'corrente',
    bank: (data.bank as string) || '',
    closingDay: (data.closingDay as number) || undefined,
    dueDay: (data.dueDay as number) || undefined,
    creditLimit: (data.creditLimit as number) || undefined,
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

  async function updateAccount(id: string, data: Partial<Account>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // O Firestore rejeita `undefined` (sem ignoreUndefinedProperties). Monta o
    // update pulando id/createdAt e qualquer chave indefinida — assim salvar só
    // o dia de vencimento com os demais campos do cartão em branco não derruba
    // o save inteiro (antes, um campo vazio lançava e perdia tudo).
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === 'id' || k === 'createdAt' || v === undefined) continue;
      update[k] = v;
    }
    await updateDoc(doc(db, 'users', uid, 'accounts', id), update);
  }

  async function deleteAccount(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'accounts', id));
  }

  const accountNames = accounts.map((a) => a.name);
  const cardAccounts = accounts.filter((a) => a.type === 'cartao');

  return { accounts, accountNames, cardAccounts, loading, addAccount, updateAccount, deleteAccount };
}

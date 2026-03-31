import { useState, useEffect, useCallback } from 'react';
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
import type { TitularMapping } from '../types';

function docToMapping(id: string, data: Record<string, unknown>): TitularMapping {
  return {
    id,
    cardLastDigits: (data.cardLastDigits as string) || '',
    titularName: (data.titularName as string) || '',
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
  };
}

export function useTitularMappings() {
  const [mappings, setMappings] = useState<TitularMapping[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const ref = collection(db, 'users', uid, 'titularMappings');
    return onSnapshot(query(ref, orderBy('titularName')), (snap) => {
      setMappings(snap.docs.map((d) => docToMapping(d.id, d.data())));
      setLoading(false);
    });
  }, []);

  async function addMapping(data: Omit<TitularMapping, 'id' | 'createdAt'>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await addDoc(collection(db, 'users', uid, 'titularMappings'), {
      ...data,
      createdAt: Timestamp.now(),
    });
  }

  async function deleteMapping(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'titularMappings', id));
  }

  const resolveTitular = useCallback(
    (cardNumber: string | null): string => {
      if (!cardNumber) return '';
      const lastDigits = cardNumber.slice(-4);
      const found = mappings.find((m) => m.cardLastDigits === lastDigits);
      return found?.titularName || '';
    },
    [mappings]
  );

  const titularNames = [...new Set(mappings.map((m) => m.titularName))];

  return { mappings, loading, addMapping, deleteMapping, resolveTitular, titularNames };
}

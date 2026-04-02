import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  updateDoc,
  writeBatch,
  Timestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { Transaction, Category, CategorizationSession, CategorizationTransaction } from '../types';

function generateToken(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Hook for the OWNER (authenticated user) to create and manage sessions
export function useCategorizationSessions() {
  const [sessions, setSessions] = useState<CategorizationSession[]>([]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // Query WITHOUT orderBy to avoid requiring a composite Firestore index.
    // Sort client-side instead.
    const ref = collection(db, 'categorizationSessions');
    const q = query(ref, where('userId', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            userId: data.userId,
            titularName: data.titularName,
            transactionIds: data.transactionIds || [],
            categorizedCount: data.categorizedCount || 0,
            expiresAt: (data.expiresAt as Timestamp).toDate(),
            createdAt: (data.createdAt as Timestamp).toDate(),
          };
        });
        // Sort client-side: newest first
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setSessions(list);
      },
      (err) => {
        console.error('Erro ao carregar sessoes de categorizacao:', err);
      }
    );
  }, []);

  async function createSession(
    titularName: string,
    transactions: Transaction[],
    categories: Category[]
  ): Promise<string> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');

    const uncategorized = transactions.filter((t) => !t.categoryId && t.amount < 0);
    if (uncategorized.length === 0) throw new Error('Nenhuma transacao sem categoria encontrada');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

    const sessionRef = doc(db, 'categorizationSessions', token);
    await setDoc(sessionRef, {
      userId: uid,
      titularName,
      transactionIds: uncategorized.map((t) => t.id),
      categorizedCount: 0,
      expiresAt: Timestamp.fromDate(expiresAt),
      createdAt: Timestamp.now(),
    });

    // Copy categories to session so the public page can access them
    const catBatch = writeBatch(db);
    for (const cat of categories) {
      const catRef = doc(db, 'categorizationSessions', token, 'categories', cat.id);
      catBatch.set(catRef, { name: cat.name, icon: cat.icon, color: cat.color, type: cat.type, parentId: cat.parentId ?? null });
    }
    await catBatch.commit();

    // Copy transactions to session sub-collection
    const txBatch = writeBatch(db);
    for (const t of uncategorized) {
      const txRef = doc(db, 'categorizationSessions', token, 'transactions', t.id);
      txBatch.set(txRef, {
        transactionId: t.id,
        description: t.description,
        amount: t.amount,
        date: Timestamp.fromDate(t.date),
        installmentNumber: t.installmentNumber,
        totalInstallments: t.totalInstallments,
        categoryId: null,
        notes: '',
      });
    }
    await txBatch.commit();

    return token;
  }

  // Read session transactions from Firestore and apply categorized ones to the real user transactions
  const applyCategorizationsFromSession = useCallback(async (token: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      console.error('applyCategorizationsFromSession: usuario nao autenticado');
      return 0;
    }

    try {
      const txSnap = await getDocs(collection(db, 'categorizationSessions', token, 'transactions'));
      const batch = writeBatch(db);
      let applied = 0;

      for (const txDoc of txSnap.docs) {
        const data = txDoc.data();
        if (data.categoryId) {
          const realTxRef = doc(db, 'users', uid, 'transactions', data.transactionId);
          batch.update(realTxRef, {
            categoryId: data.categoryId,
            ...(data.notes ? { notes: data.notes } : {}),
          });
          applied++;
        }
      }

      if (applied > 0) {
        await batch.commit();
      }
      return applied;
    } catch (err) {
      console.error('Erro ao aplicar categorizacoes:', err);
      alert('Erro ao aplicar categorizacoes. Verifique o console para mais detalhes.');
      return 0;
    }
  }, []);

  // Apply all pending sessions at once — called by TransactionsPage on mount
  const applyAllPendingSessions = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return 0;

    let totalApplied = 0;
    for (const s of sessions) {
      if (s.expiresAt > new Date()) {
        const applied = await applyCategorizationsFromSession(s.id);
        totalApplied += applied;
      }
    }
    return totalApplied;
  }, [sessions, applyCategorizationsFromSession]);

  return { sessions, createSession, applyCategorizationsFromSession, applyAllPendingSessions };
}

// Hook for the PUBLIC page (no auth required) to load and update a session
export function usePublicCategorizationSession(token: string) {
  const [session, setSession] = useState<CategorizationSession | null>(null);
  const [transactions, setTransactions] = useState<CategorizationTransaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const sessionRef = doc(db, 'categorizationSessions', token);
        const sessionSnap = await getDoc(sessionRef);

        if (!sessionSnap.exists()) {
          setError('Link invalido ou expirado.');
          setLoading(false);
          return;
        }

        const data = sessionSnap.data();
        const expiresAt = (data.expiresAt as Timestamp).toDate();
        if (expiresAt < new Date()) {
          setError('Este link expirou. Peca um novo link.');
          setLoading(false);
          return;
        }

        setSession({
          id: sessionSnap.id,
          userId: data.userId,
          titularName: data.titularName,
          transactionIds: data.transactionIds || [],
          categorizedCount: data.categorizedCount || 0,
          expiresAt,
          createdAt: (data.createdAt as Timestamp).toDate(),
        });

        // Load categories
        const catSnap = await getDocs(collection(db, 'categorizationSessions', token, 'categories'));
        setCategories(
          catSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            icon: d.data().icon,
            color: d.data().color,
            type: d.data().type,
            parentId: d.data().parentId ?? null,
            createdAt: new Date(),
          }))
        );

        // Load transactions
        const txSnap = await getDocs(collection(db, 'categorizationSessions', token, 'transactions'));
        setTransactions(
          txSnap.docs.map((d) => {
            const td = d.data();
            return {
              id: d.id,
              transactionId: td.transactionId,
              description: td.description,
              amount: td.amount,
              date: (td.date as Timestamp).toDate(),
              installmentNumber: td.installmentNumber,
              totalInstallments: td.totalInstallments,
              categoryId: td.categoryId || null,
              notes: td.notes || '',
            };
          })
        );

        setLoading(false);
      } catch {
        setError('Erro ao carregar dados. Tente novamente.');
        setLoading(false);
      }
    }

    load();
  }, [token]);

  async function categorizeTransaction(txId: string, categoryId: string, notes: string) {
    // 1. Update the session transaction in Firestore
    const txRef = doc(db, 'categorizationSessions', token, 'transactions', txId);
    await updateDoc(txRef, { categoryId, notes });

    // 2. Update local state
    setTransactions((prev) =>
      prev.map((t) => (t.id === txId ? { ...t, categoryId, notes } : t))
    );

    // 3. Update categorized count on the session document
    // Use a functional approach to get the correct count after state update
    try {
      // Read fresh count from Firestore to avoid stale state
      const txSnap = await getDocs(collection(db, 'categorizationSessions', token, 'transactions'));
      const count = txSnap.docs.filter((d) => d.data().categoryId).length;
      const sessionRef = doc(db, 'categorizationSessions', token);
      await updateDoc(sessionRef, { categorizedCount: count });
    } catch {
      // Non-critical — count is just for display
    }
  }

  return { session, transactions, categories, loading, error, categorizeTransaction };
}

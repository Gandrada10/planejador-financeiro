import { useState, useEffect, useCallback, useMemo } from 'react';
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
import type {
  Transaction,
  Category,
  CategorizationSession,
  CategorizationSessionStatus,
  CategorizationTransaction,
} from '../types';

function generateToken(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

const HISTORY_RETENTION_DAYS = 90;

function parseSession(id: string, data: Record<string, unknown>): CategorizationSession {
  const expiresAtRaw = data.expiresAt as Timestamp | undefined;
  const createdAtRaw = data.createdAt as Timestamp | undefined;
  const appliedAtRaw = data.appliedAt as Timestamp | null | undefined;
  const lastActivityAtRaw = data.lastActivityAt as Timestamp | null | undefined;

  const categorizedCount = (data.categorizedCount as number) || 0;
  const storedStatus = data.status as CategorizationSessionStatus | undefined;
  // Legacy rows (before the history feature) used expiresAt=0 to dismiss.
  // Derive a status so they show up correctly in the UI.
  const expiresAt = expiresAtRaw ? expiresAtRaw.toDate() : new Date(0);
  const status: CategorizationSessionStatus =
    storedStatus ?? (expiresAt.getTime() === 0 ? 'dismissed' : 'active');

  return {
    id,
    userId: data.userId as string,
    titularName: data.titularName as string,
    transactionIds: ((data.transactionIds as string[]) || []),
    categorizedCount,
    expiresAt,
    createdAt: createdAtRaw ? createdAtRaw.toDate() : new Date(),
    status,
    monthFilter: (data.monthFilter as string) || 'all',
    accounts: ((data.accounts as string[]) || []),
    totalAmount: (data.totalAmount as number) || 0,
    appliedAt: appliedAtRaw ? appliedAtRaw.toDate() : null,
    appliedCount: (data.appliedCount as number) || 0,
    lastActivityAt: lastActivityAtRaw ? lastActivityAtRaw.toDate() : null,
  };
}

export async function fetchSessionTransactions(token: string): Promise<CategorizationTransaction[]> {
  const txSnap = await getDocs(collection(db, 'categorizationSessions', token, 'transactions'));
  return txSnap.docs.map((d) => {
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
  });
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
        const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const list = snap.docs
          .map((d) => parseSession(d.id, d.data()))
          .filter((s) => s.createdAt.getTime() >= cutoff);
        // Sort client-side: newest first
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setSessions(list);
      },
      (err) => {
        console.error('Erro ao carregar sessoes de categorizacao:', err);
      }
    );
  }, []);

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status === 'active' && s.expiresAt > new Date()),
    [sessions]
  );
  const historySessions = useMemo(
    () => sessions.filter((s) => s.status === 'applied' || s.status === 'dismissed'),
    [sessions]
  );

  async function createSession(
    titularName: string,
    transactions: Transaction[],
    categories: Category[],
    context: { monthFilter: string }
  ): Promise<string> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');

    const uncategorized = transactions.filter((t) => !t.categoryId);
    if (uncategorized.length === 0) throw new Error('Nenhuma transacao sem categoria encontrada');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
    const accounts = Array.from(new Set(uncategorized.map((t) => t.account).filter(Boolean))).sort();
    const totalAmount = uncategorized.reduce((s, t) => s + t.amount, 0);

    const sessionRef = doc(db, 'categorizationSessions', token);
    await setDoc(sessionRef, {
      userId: uid,
      titularName,
      transactionIds: uncategorized.map((t) => t.id),
      categorizedCount: 0,
      expiresAt: Timestamp.fromDate(expiresAt),
      createdAt: Timestamp.now(),
      status: 'active' as CategorizationSessionStatus,
      monthFilter: context.monthFilter,
      accounts,
      totalAmount,
      appliedAt: null,
      appliedCount: 0,
      lastActivityAt: null,
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
      const sessionRef = doc(db, 'categorizationSessions', token);
      await updateDoc(sessionRef, {
        status: 'applied' as CategorizationSessionStatus,
        appliedAt: Timestamp.now(),
        appliedCount: applied,
      });
      return applied;
    } catch (err) {
      console.error('Erro ao aplicar categorizacoes:', err);
      alert('Erro ao aplicar categorizacoes. Verifique o console para mais detalhes.');
      return 0;
    }
  }, []);

  // Apply all pending sessions at once — called by TransactionsPage on mount.
  // Only auto-applies sessions where the recipient already categorized something,
  // so freshly-shared sessions (still being filled in) stay visible in the active panel.
  const applyAllPendingSessions = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return 0;

    let totalApplied = 0;
    for (const s of sessions) {
      if (s.status === 'active' && s.categorizedCount > 0) {
        const applied = await applyCategorizationsFromSession(s.id);
        totalApplied += applied;
      }
    }
    return totalApplied;
  }, [sessions, applyCategorizationsFromSession]);

  const dismissSession = useCallback(async (token: string) => {
    try {
      const sessionRef = doc(db, 'categorizationSessions', token);
      await updateDoc(sessionRef, { status: 'dismissed' as CategorizationSessionStatus });
    } catch (err) {
      console.error('Erro ao dispensar sessao:', err);
    }
  }, []);

  return {
    sessions,
    activeSessions,
    historySessions,
    createSession,
    applyCategorizationsFromSession,
    applyAllPendingSessions,
    dismissSession,
  };
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
        const parsed = parseSession(sessionSnap.id, data);
        if (parsed.expiresAt < new Date()) {
          setError('Este link expirou. Peca um novo link.');
          setLoading(false);
          return;
        }

        setSession(parsed);

        // Load categories (sort alphabetically so mobile matches desktop order)
        const catSnap = await getDocs(collection(db, 'categorizationSessions', token, 'categories'));
        setCategories(
          catSnap.docs
            .map((d) => ({
              id: d.id,
              name: d.data().name as string,
              icon: d.data().icon as string,
              color: d.data().color as string,
              type: d.data().type as Category['type'],
              parentId: (d.data().parentId as string | null) ?? null,
              createdAt: new Date(),
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
        );

        // Load transactions
        setTransactions(await fetchSessionTransactions(token));

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
      await updateDoc(sessionRef, { categorizedCount: count, lastActivityAt: Timestamp.now() });
    } catch {
      // Non-critical — count is just for display
    }
  }

  return { session, transactions, categories, loading, error, categorizeTransaction };
}

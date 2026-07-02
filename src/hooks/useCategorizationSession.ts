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
  CategoryRule,
  CategorizationSession,
  CategorizationSessionStatus,
  CategorizationTransaction,
} from '../types';
import { normalizeDescriptionForDedup } from '../lib/utils';

function generateToken(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

const HISTORY_RETENTION_DAYS = 90;

// ---------------------------------------------------------------------------
// Sugestões pré-calculadas (sem IA): regras do dono + histórico de escolhas.
// Rodam na CRIAÇÃO da sessão, no dispositivo do dono (autenticado). A esposa só
// vê a sugestão pronta — 1 toque confirma, zero latência e zero custo por toque.
// ---------------------------------------------------------------------------

function patternMatches(lower: string, rawPattern: string): boolean {
  const pattern = rawPattern.toLowerCase();
  if (pattern.startsWith('*') && pattern.endsWith('*')) return lower.includes(pattern.slice(1, -1));
  if (pattern.startsWith('*')) return lower.endsWith(pattern.slice(1));
  if (pattern.endsWith('*')) return lower.startsWith(pattern.slice(0, -1));
  return lower.includes(pattern);
}

function matchRule(description: string, rules: CategoryRule[]): string | null {
  const lower = description.toLowerCase();
  for (const rule of rules) {
    if (rule.pattern && patternMatches(lower, rule.pattern)) return rule.categoryId;
    if (rule.keywords?.length) {
      for (const kw of rule.keywords) {
        if (kw && patternMatches(lower, kw)) return rule.categoryId;
      }
    }
  }
  return null;
}

function allowedForAmount(category: Category | undefined, amount: number): boolean {
  if (!category) return false;
  return amount >= 0
    ? category.type === 'receita' || category.type === 'ambos'
    : category.type === 'despesa' || category.type === 'ambos';
}

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
    topCategoryIds: ((data.topCategoryIds as string[]) || []),
  };
}

function docToSessionTransaction(id: string, td: Record<string, unknown>): CategorizationTransaction {
  return {
    id,
    transactionId: td.transactionId as string,
    description: td.description as string,
    amount: td.amount as number,
    date: (td.date as Timestamp).toDate(),
    installmentNumber: (td.installmentNumber as number) ?? null,
    totalInstallments: (td.totalInstallments as number) ?? null,
    categoryId: (td.categoryId as string) || null,
    notes: (td.notes as string) || '',
    suggestedCategoryId: (td.suggestedCategoryId as string) || null,
    suggestionReason: (td.suggestionReason as string) || null,
  };
}

export async function fetchSessionTransactions(token: string): Promise<CategorizationTransaction[]> {
  const txSnap = await getDocs(collection(db, 'categorizationSessions', token, 'transactions'));
  return txSnap.docs.map((d) => docToSessionTransaction(d.id, d.data()));
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
    context: { monthFilter: string },
    rules: CategoryRule[] = [],
    // Fonte do histórico para sugestões — a base COMPLETA (todos os meses),
    // enquanto `transactions` define apenas o ESCOPO compartilhado (o filtro).
    historyTransactions: Transaction[] = transactions
  ): Promise<string> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');

    const uncategorized = transactions.filter((t) => !t.categoryId);
    if (uncategorized.length === 0) throw new Error('Nenhuma transacao sem categoria encontrada');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
    const accounts = Array.from(new Set(uncategorized.map((t) => t.account).filter(Boolean))).sort();
    const totalAmount = uncategorized.reduce((s, t) => s + t.amount, 0);

    // --- Aprendizado com o histórico do dono (transações já categorizadas) ---
    const catById = new Map(categories.map((c) => [c.id, c]));
    // normalizedDesc -> (categoryId -> nº de vezes escolhida)
    const history = new Map<string, Map<string, number>>();
    // categoryId -> uso total (para a grade de acesso rápido)
    const usage = new Map<string, number>();
    for (const t of historyTransactions) {
      if (!t.categoryId) continue;
      usage.set(t.categoryId, (usage.get(t.categoryId) || 0) + 1);
      const key = normalizeDescriptionForDedup(t.description);
      if (!key) continue;
      const m = history.get(key) || new Map<string, number>();
      m.set(t.categoryId, (m.get(t.categoryId) || 0) + 1);
      history.set(key, m);
    }
    const topCategoryIds = Array.from(usage.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, 8);

    function suggestFor(description: string, amount: number): { id: string | null; reason: string | null } {
      // 1) Regras explícitas do dono
      const byRule = matchRule(description, rules);
      if (byRule && allowedForAmount(catById.get(byRule), amount)) {
        return { id: byRule, reason: 'Regra automática' };
      }
      // 2) Histórico: categoria mais frequente para a mesma descrição
      const key = normalizeDescriptionForDedup(description);
      const m = history.get(key);
      if (m) {
        let best: string | null = null;
        let bestN = 0;
        for (const [cid, n] of m) {
          if (n > bestN && allowedForAmount(catById.get(cid), amount)) {
            best = cid;
            bestN = n;
          }
        }
        if (best) {
          return { id: best, reason: bestN > 1 ? `Você já categorizou assim ${bestN}×` : 'Você já categorizou assim' };
        }
      }
      return { id: null, reason: null };
    }

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
      topCategoryIds,
    });

    // Copy categories to session so the public page can access them
    const catBatch = writeBatch(db);
    for (const cat of categories) {
      const catRef = doc(db, 'categorizationSessions', token, 'categories', cat.id);
      catBatch.set(catRef, { name: cat.name, icon: cat.icon, color: cat.color, type: cat.type, parentId: cat.parentId ?? null });
    }
    await catBatch.commit();

    // Copy transactions to session sub-collection, each with its pre-computed suggestion
    const txBatch = writeBatch(db);
    for (const t of uncategorized) {
      const suggestion = suggestFor(t.description, t.amount);
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
        suggestedCategoryId: suggestion.id,
        suggestionReason: suggestion.reason,
        applied: false,
      });
    }
    await txBatch.commit();

    return token;
  }

  // Read session transactions and apply the categorized ones to the real user
  // transactions. FIX do bug crítico: a sessão só é marcada 'applied' quando
  // TODAS as transações foram categorizadas. Enquanto houver pendentes, ela
  // permanece 'active' e cada abertura aplica apenas o DELTA (as ainda não
  // aplicadas, marcadas com applied=true na subcoleção). Assim o trabalho feito
  // aos poucos nunca é descartado.
  const applyCategorizationsFromSession = useCallback(async (token: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      console.error('applyCategorizationsFromSession: usuario nao autenticado');
      return 0;
    }

    try {
      const txSnap = await getDocs(collection(db, 'categorizationSessions', token, 'transactions'));
      const batch = writeBatch(db);
      let appliedNow = 0;
      let categorized = 0;
      let total = 0;

      for (const txDoc of txSnap.docs) {
        total++;
        const data = txDoc.data();
        if (!data.categoryId) continue;
        categorized++;
        if (data.applied) continue; // já aplicada em abertura anterior — pula
        const realTxRef = doc(db, 'users', uid, 'transactions', data.transactionId);
        batch.update(realTxRef, {
          categoryId: data.categoryId,
          ...(data.notes ? { notes: data.notes } : {}),
        });
        batch.update(txDoc.ref, { applied: true });
        appliedNow++;
      }

      if (appliedNow > 0) await batch.commit();

      const allDone = total > 0 && categorized === total;
      const sessionRef = doc(db, 'categorizationSessions', token);
      await updateDoc(sessionRef, {
        appliedCount: categorized,
        lastActivityAt: Timestamp.now(),
        ...(allDone
          ? { status: 'applied' as CategorizationSessionStatus, appliedAt: Timestamp.now() }
          : {}),
      });
      return appliedNow;
    } catch (err) {
      console.error('Erro ao aplicar categorizacoes:', err);
      return 0;
    }
  }, []);

  // Apply all pending sessions — called by TransactionsPage on mount.
  // Reaplica o delta de qualquer sessão ativa que já tenha algo categorizado;
  // como as transações já aplicadas ficam marcadas, reprocessar é barato.
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

  // Atualiza a contagem da sessão a partir do estado local (sem reler a
  // subcoleção inteira a cada toque — antes era O(n) leituras por categorização).
  const pushCount = useCallback(
    (next: CategorizationTransaction[]) => {
      const count = next.filter((t) => t.categoryId).length;
      const sessionRef = doc(db, 'categorizationSessions', token);
      updateDoc(sessionRef, { categorizedCount: count, lastActivityAt: Timestamp.now() }).catch(() => {
        // não-crítico: a contagem é só para exibição
      });
    },
    [token]
  );

  const categorizeTransaction = useCallback(
    async (txId: string, categoryId: string, notes: string) => {
      const txRef = doc(db, 'categorizationSessions', token, 'transactions', txId);
      // applied:false garante que o dono reaplique este delta na próxima abertura
      await updateDoc(txRef, { categoryId, notes, applied: false });
      setTransactions((prev) => {
        const next = prev.map((t) => (t.id === txId ? { ...t, categoryId, notes } : t));
        pushCount(next);
        return next;
      });
    },
    [token, pushCount]
  );

  // Desfazer: devolve a transação para o estado não categorizado.
  const uncategorizeTransaction = useCallback(
    async (txId: string) => {
      const txRef = doc(db, 'categorizationSessions', token, 'transactions', txId);
      await updateDoc(txRef, { categoryId: null, notes: '', applied: false });
      setTransactions((prev) => {
        const next = prev.map((t) => (t.id === txId ? { ...t, categoryId: null, notes: '' } : t));
        pushCount(next);
        return next;
      });
    },
    [token, pushCount]
  );

  return { session, transactions, categories, loading, error, categorizeTransaction, uncategorizeTransaction };
}

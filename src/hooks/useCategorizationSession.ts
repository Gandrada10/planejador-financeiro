import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  updateDoc,
  writeBatch,
  increment,
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
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48h

// Firestore limita um writeBatch a 500 operações. Mesmo padrão de
// useTransactions.ts (commitInChunks): commit em blocos para que sessões
// grandes não estourem o limite e falhem por inteiro. `opsPerItem` cobre o
// apply, que gasta 2 operações por transação (real + subcoleção).
const BATCH_CHUNK = 400;

async function commitInChunks<T>(
  items: T[],
  apply: (batch: ReturnType<typeof writeBatch>, item: T) => void,
  opsPerItem = 1
) {
  const perChunk = Math.max(1, Math.floor(BATCH_CHUNK / opsPerItem));
  for (let i = 0; i < items.length; i += perChunk) {
    const batch = writeBatch(db);
    for (const item of items.slice(i, i + perChunk)) apply(batch, item);
    await batch.commit();
  }
}

// Resultado real do apply — a UI mostra aplicados/pulados e o erro, se houver.
export interface ApplySessionResult {
  applied: number;
  skipped: number;
  error: string | null;
}

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
    // Sessões criadas antes do chip da conta não têm o campo → null (a UI
    // simplesmente não mostra o chip).
    account: (td.account as string) || null,
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
  // C1(b): sessões expiradas que nunca foram aplicadas/dispensadas NÃO podem
  // ficar invisíveis — o dono precisa vê-las ("expirada — X pendentes") com
  // ação de reabrir ou aplicar as parciais.
  const expiredSessions = useMemo(
    () => sessions.filter((s) => s.status === 'active' && s.expiresAt <= new Date()),
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
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
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

    // Granularidade: quando a escolha recai num PAI (ex.: "Alimentação") mas o
    // histórico daquela mesma descrição também traz uma SUBcategoria desse pai
    // (ex.: "Mercado"), preferir a sub. Sem isso, o auto-preenchimento por regra
    // — que costuma apontar para o pai — colapsava a sugestão no nível errado,
    // mesmo havendo sinal claro do dono para a sub. Só troca quando há sinal
    // (uma sub válida para o sinal do valor aparece no histórico da descrição).
    function refineToSub(chosenId: string, m: Map<string, number> | undefined, amount: number): string {
      const chosen = catById.get(chosenId);
      if (!chosen || chosen.parentId) return chosenId; // já é sub (ou desconhecida)
      if (!m) return chosenId;
      let bestChild: string | null = null;
      let bestN = 0;
      for (const [cid, n] of m) {
        const c = catById.get(cid);
        if (c && c.parentId === chosenId && allowedForAmount(c, amount) && n > bestN) {
          bestChild = cid;
          bestN = n;
        }
      }
      return bestChild ?? chosenId;
    }

    function suggestFor(description: string, amount: number): { id: string | null; reason: string | null } {
      const key = normalizeDescriptionForDedup(description);
      const m = history.get(key);
      // 1) Regras explícitas do dono (refinadas para a sub, se houver sinal)
      const byRule = matchRule(description, rules);
      if (byRule && allowedForAmount(catById.get(byRule), amount)) {
        return { id: refineToSub(byRule, m, amount), reason: 'Regra automática' };
      }
      // 2) Histórico: categoria mais frequente para a mesma descrição
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
          // Não colapsar no pai quando a sub tem sinal no mesmo histórico.
          const refined = refineToSub(best, m, amount);
          const n = m.get(refined) ?? bestN;
          return { id: refined, reason: n > 1 ? `Você já categorizou assim ${n}×` : 'Você já categorizou assim' };
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

    // Copy categories to session so the public page can access them.
    // C4: em blocos — um batch único estoura o limite de 500 operações.
    await commitInChunks(categories, (batch, cat) => {
      const catRef = doc(db, 'categorizationSessions', token, 'categories', cat.id);
      batch.set(catRef, { name: cat.name, icon: cat.icon, color: cat.color, type: cat.type, parentId: cat.parentId ?? null });
    });

    // Copy transactions to session sub-collection, each with its pre-computed
    // suggestion. C4: em blocos (>500 lançamentos falhava por inteiro).
    await commitInChunks(uncategorized, (batch, t) => {
      const suggestion = suggestFor(t.description, t.amount);
      const txRef = doc(db, 'categorizationSessions', token, 'transactions', t.id);
      batch.set(txRef, {
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
        // Conta/cartão de origem — dá contexto no card da esposa (casal com
        // vários cartões). Sessões antigas não têm o campo (UI degrada).
        account: t.account ?? null,
        applied: false,
      });
    });

    return token;
  }

  // Read session transactions and apply the categorized ones to the real user
  // transactions. FIX do bug crítico: a sessão só é marcada 'applied' quando
  // TODAS as transações foram categorizadas. Enquanto houver pendentes, ela
  // permanece 'active' e cada abertura aplica apenas o DELTA (as ainda não
  // aplicadas, marcadas com applied=true na subcoleção). Assim o trabalho feito
  // aos poucos nunca é descartado.
  const applyCategorizationsFromSession = useCallback(async (token: string): Promise<ApplySessionResult> => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      return { applied: 0, skipped: 0, error: 'Você precisa estar logado para aplicar.' };
    }

    try {
      const sessionRef = doc(db, 'categorizationSessions', token);
      const sessionSnap = await getDoc(sessionRef);
      if (!sessionSnap.exists()) {
        return { applied: 0, skipped: 0, error: 'Sessão não encontrada.' };
      }
      const sessionData = parseSession(sessionSnap.id, sessionSnap.data());

      const txSnap = await getDocs(collection(db, 'categorizationSessions', token, 'transactions'));
      let categorized = 0;
      let total = 0;
      const pendingDeltas: { ref: (typeof txSnap.docs)[number]['ref']; transactionId: string; categoryId: string; notes: string }[] = [];

      for (const txDoc of txSnap.docs) {
        total++;
        const data = txDoc.data();
        if (!data.categoryId) continue;
        categorized++;
        if (data.applied) continue; // já aplicada em abertura anterior — pula
        pendingDeltas.push({
          ref: txDoc.ref,
          transactionId: data.transactionId as string,
          categoryId: data.categoryId as string,
          notes: (data.notes as string) || '',
        });
      }

      // C3: transação apagada pelo dono não pode envenenar o apply — um
      // batch.update em doc inexistente falha o batch INTEIRO. Verifica a
      // existência antes, aplica as que existem e marca as órfãs como
      // consumidas (applied + orphaned) para a falha não se repetir a cada
      // abertura. O resultado real (aplicadas/puladas) vai para a UI.
      const existence = await Promise.all(
        pendingDeltas.map((p) => getDoc(doc(db, 'users', uid, 'transactions', p.transactionId)))
      );
      const toApply: typeof pendingDeltas = [];
      const orphaned: typeof pendingDeltas = [];
      pendingDeltas.forEach((p, i) => (existence[i].exists() ? toApply : orphaned).push(p));

      // C4: 2 operações por transação → chunking obrigatório (>250 deltas
      // estourava o limite de 500 do writeBatch).
      await commitInChunks(
        toApply,
        (batch, p) => {
          batch.update(doc(db, 'users', uid, 'transactions', p.transactionId), {
            categoryId: p.categoryId,
            ...(p.notes ? { notes: p.notes } : {}),
          });
          batch.update(p.ref, { applied: true });
        },
        2
      );
      await commitInChunks(orphaned, (batch, p) => {
        batch.update(p.ref, { applied: true, orphaned: true });
      });

      const allDone = total > 0 && categorized === total;

      // C1(a): renovação da janela por atividade, gravada pelo DONO — assim
      // continua funcionando mesmo com `expiresAt` imutável no update PÚBLICO
      // das rules (decisão de segurança do Vex). Cada categorização da esposa
      // grava lastActivityAt (update público); aqui o dono estende expiresAt
      // para lastActivityAt + 48h (nunca encurta). Limitação aceita e
      // documentada: a renovação só persiste quando o dono abre o app/aplica;
      // se ele ficar dias sem abrir, a sessão pode expirar — mas aí ela
      // aparece na lista como "expirada — X pendentes", com ação de reabrir.
      let renewedExpiresAt: Timestamp | null = null;
      if (!allDone && sessionData.status === 'active' && sessionData.lastActivityAt) {
        const candidate = new Date(sessionData.lastActivityAt.getTime() + SESSION_TTL_MS);
        if (candidate > sessionData.expiresAt) renewedExpiresAt = Timestamp.fromDate(candidate);
      }

      // lastActivityAt NÃO é tocado aqui: o campo significa "última atividade
      // de quem categoriza" (gravado pela página pública), não "último apply".
      await updateDoc(sessionRef, {
        appliedCount: categorized,
        ...(renewedExpiresAt ? { expiresAt: renewedExpiresAt } : {}),
        ...(allDone
          ? { status: 'applied' as CategorizationSessionStatus, appliedAt: Timestamp.now() }
          : {}),
      });
      return { applied: toApply.length, skipped: orphaned.length, error: null };
    } catch (err) {
      console.error('Erro ao aplicar categorizacoes:', err);
      return {
        applied: 0,
        skipped: 0,
        error: 'Não consegui aplicar as categorizações — verifique a internet e tente de novo.',
      };
    }
  }, []);

  // Apply all pending sessions — called by TransactionsPage on mount.
  // Reaplica o delta de sessões com status 'active' (inclusive as já
  // expiradas) que tenham `categorizedCount > 0` no doc da sessão; o delta
  // real é lido da subcoleção ao aplicar. Como as transações já aplicadas
  // ficam marcadas, reprocessar é barato.
  const applyAllPendingSessions = useCallback(async (): Promise<{ applied: number; skipped: number; errors: string[] }> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return { applied: 0, skipped: 0, errors: [] };

    let applied = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const s of sessions) {
      if (s.status === 'active' && s.categorizedCount > 0) {
        const res = await applyCategorizationsFromSession(s.id);
        applied += res.applied;
        skipped += res.skipped;
        if (res.error) errors.push(`${s.titularName}: ${res.error}`);
      }
    }
    return { applied, skipped, errors };
  }, [sessions, applyCategorizationsFromSession]);

  // C1(b): reabre uma sessão (expirada ou não) por mais 48h a partir de agora.
  // Ação explícita do DONO autenticado — compatível com rules que tornem
  // `expiresAt` imutável no update público. Lança em caso de falha (a UI trata).
  const reopenSession = useCallback(async (token: string) => {
    const sessionRef = doc(db, 'categorizationSessions', token);
    await updateDoc(sessionRef, {
      expiresAt: Timestamp.fromDate(new Date(Date.now() + SESSION_TTL_MS)),
    });
  }, []);

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
    expiredSessions,
    historySessions,
    createSession,
    applyCategorizationsFromSession,
    applyAllPendingSessions,
    reopenSession,
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

  // Espelho do estado atual para calcular deltas fora do updater do setState
  // (efeito colateral dentro do updater rodaria 2× no StrictMode).
  const transactionsRef = useRef<CategorizationTransaction[]>([]);
  useEffect(() => {
    transactionsRef.current = transactions;
  }, [transactions]);

  // C5 (parcial): a contagem usa increment() atômico em vez de sobrescrever o
  // doc com a contagem do estado LOCAL — duas abas/aparelhos não se atropelam
  // mais com valor stale. As rules podem validar o valor final normalmente
  // (request.resource.data já reflete o transform aplicado).
  const pushActivity = useCallback(
    (delta: number) => {
      const sessionRef = doc(db, 'categorizationSessions', token);
      updateDoc(sessionRef, { categorizedCount: increment(delta), lastActivityAt: Timestamp.now() }).catch(() => {
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
      const prev = transactionsRef.current.find((t) => t.id === txId);
      const delta = prev && !prev.categoryId ? 1 : 0; // recategorizar não muda a contagem
      setTransactions((list) => list.map((t) => (t.id === txId ? { ...t, categoryId, notes } : t)));
      pushActivity(delta);
    },
    [token, pushActivity]
  );

  // Desfazer: devolve a transação para o estado não categorizado.
  const uncategorizeTransaction = useCallback(
    async (txId: string) => {
      const txRef = doc(db, 'categorizationSessions', token, 'transactions', txId);
      await updateDoc(txRef, { categoryId: null, notes: '', applied: false });
      const prev = transactionsRef.current.find((t) => t.id === txId);
      const delta = prev && prev.categoryId ? -1 : 0;
      setTransactions((list) => list.map((t) => (t.id === txId ? { ...t, categoryId: null, notes: '' } : t)));
      pushActivity(delta);
    },
    [token, pushActivity]
  );

  return { session, transactions, categories, loading, error, categorizeTransaction, uncategorizeTransaction };
}

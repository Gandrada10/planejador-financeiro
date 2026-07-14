import {
  collection,
  getDocs,
  getDocsFromCache,
  writeBatch,
  doc,
  Timestamp,
  waitForPendingWrites,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db, auth } from './firebase';

// Collections stored under users/{uid}/{collection}
// Keep this list in sync with the hooks that read/write user data.
export const USER_COLLECTIONS = [
  'transactions',
  'categories',
  'categoryRules',
  'accounts',
  'familyMembers',
  'titularMappings',
  'billingCycles',
  'projects',
  'budgets',
] as const;

export type UserCollection = (typeof USER_COLLECTIONS)[number];

export const BACKUP_FORMAT_VERSION = 1;

// LocalStorage keys that hold per-device configuration worth backing up.
// Tokens like the anthropic API key are intentionally included so a
// full restore brings the app back exactly where it was.
const LOCAL_STORAGE_KEYS = [
  'anthropic_api_key',
];

export interface BackupFile {
  formatVersion: number;
  exportedAt: string; // ISO
  appName: string;
  userId: string;
  userEmail: string | null;
  collections: Record<string, Array<{ id: string; data: Record<string, unknown> }>>;
  localStorage: Record<string, string>;
}

// ---------- serialization helpers ----------

// Marker we use to round-trip Firestore Timestamps through JSON.
const TIMESTAMP_MARKER = '__firestoreTimestamp__';

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Timestamp) {
    return { [TIMESTAMP_MARKER]: true, seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof Date) {
    return { [TIMESTAMP_MARKER]: true, seconds: Math.floor(value.getTime() / 1000), nanoseconds: (value.getTime() % 1000) * 1e6 };
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeValue(v);
    }
    return out;
  }
  return value;
}

function deserializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(deserializeValue);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj[TIMESTAMP_MARKER] === true) {
      const seconds = Number(obj.seconds) || 0;
      const nanoseconds = Number(obj.nanoseconds) || 0;
      return new Timestamp(seconds, nanoseconds);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = deserializeValue(v);
    }
    return out;
  }
  return value;
}

// ---------- export ----------

export async function exportBackup(): Promise<BackupFile> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuario nao autenticado.');
  const uid = user.uid;

  const collections: BackupFile['collections'] = {};

  for (const name of USER_COLLECTIONS) {
    const snap = await getDocs(collection(db, 'users', uid, name));
    collections[name] = snap.docs.map((d) => ({
      id: d.id,
      data: serializeValue(d.data()) as Record<string, unknown>,
    }));
  }

  const localStorageDump: Record<string, string> = {};
  for (const key of LOCAL_STORAGE_KEYS) {
    const v = localStorage.getItem(key);
    if (v !== null) localStorageDump[key] = v;
  }

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appName: 'planejador-financeiro',
    userId: uid,
    userEmail: user.email ?? null,
    collections,
    localStorage: localStorageDump,
  };
}

export function downloadBackup(backup: BackupFile) {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const a = document.createElement('a');
  a.href = url;
  a.download = `planejador-financeiro-backup_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function summarizeBackup(backup: BackupFile): { collection: string; count: number }[] {
  return Object.entries(backup.collections).map(([k, arr]) => ({ collection: k, count: arr.length }));
}

// ---------- validation ----------

export function validateBackup(raw: unknown): BackupFile {
  if (!raw || typeof raw !== 'object') throw new Error('Arquivo invalido: nao e um objeto JSON.');
  const b = raw as Partial<BackupFile>;
  if (typeof b.formatVersion !== 'number') throw new Error('Arquivo invalido: formatVersion ausente.');
  if (b.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error(`Versao do backup (${b.formatVersion}) nao suportada por esta versao do app.`);
  }
  if (!b.collections || typeof b.collections !== 'object') throw new Error('Arquivo invalido: collections ausente.');
  return {
    formatVersion: b.formatVersion,
    exportedAt: b.exportedAt || '',
    appName: b.appName || 'planejador-financeiro',
    userId: b.userId || '',
    userEmail: b.userEmail ?? null,
    collections: b.collections as BackupFile['collections'],
    localStorage: (b.localStorage as Record<string, string>) || {},
  };
}

// ---------- import (restore) ----------

export interface RestoreResult {
  deleted: Record<string, number>;
  written: Record<string, number>;
  localStorageKeys: number;
  /**
   * true  = o servidor confirmou toda a gravação antes de retornarmos.
   * false = os dados já estão salvos localmente (cache offline) e a
   *         sincronização com o servidor continua em segundo plano.
   *         O app já funciona; só não convém fechar a aba até terminar.
   */
  serverAckComplete: boolean;
  /** Lotes que o servidor rejeitou (0 = tudo certo ou ainda sincronizando). */
  failedChunks: number;
}

export interface RestoreProgress {
  phase: 'reading' | 'deleting' | 'writing' | 'syncing' | 'done';
  collection?: string;
  /** Documentos já enviados para gravação (acumulado). */
  written: number;
  /** Total de documentos a gravar (todas as coleções). */
  totalToWrite: number;
}

// Firestore limita um batch a 500 operações — quebramos em lotes menores.
const BATCH_LIMIT = 450;
// Quanto tempo esperamos, no máximo, a leitura da coleção existente (fase de
// limpeza) antes de cair para o cache local. Nunca deixamos travar indefinido.
const READ_TIMEOUT_MS = 15_000;
// Tempo máximo aguardando o servidor confirmar TODAS as gravações. Passando
// disso, retornamos assim mesmo (o indicador de sync avisa que ainda falta) —
// com cache offline os dados já estão salvos localmente. É o teto que evita o
// travamento, sem mentir que gravou no servidor quando não gravou.
const ACK_WAIT_TIMEOUT_MS = 120_000;

/** Rejeita a promise se ela não resolver dentro de `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** Cede o event loop para o cache local assentar e a UI repintar. */
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Dispara as operações em lotes e devolve as promises de commit — SEM esperar
 * a confirmação do servidor. Com cache offline persistente, cada commit aplica
 * a escrita no cache local na hora (latency compensation); a promise só resolve
 * quando o servidor confirma. Esperar por isso, lote a lote, é o que travava a
 * restauração quando a conexão de sync engasgava. Aqui só cedemos a UI entre os
 * lotes e deixamos a confirmação do servidor para uma espera única, com teto.
 */
async function fireInChunks(
  operations: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  onChunk?: (chunkSize: number) => void
): Promise<Promise<void>[]> {
  const commits: Promise<void>[] = [];
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + BATCH_LIMIT);
    for (const op of chunk) op(batch);
    const p = batch.commit();
    // A confirmação é aguardada em bloco no fim; aqui só evitamos que uma
    // eventual rejeição vire "unhandled rejection".
    p.catch(() => {});
    commits.push(p);
    onChunk?.(chunk.length);
    await yieldToUi();
  }
  return commits;
}

/**
 * Restore a backup file.
 *
 * - wipeExisting=true (recomendado para recuperação de desastre): apaga cada
 *   documento das coleções do usuário antes de gravar o backup, de modo que o
 *   estado final bata exatamente com o arquivo.
 * - wipeExisting=false: mescla por id de documento. Ids em conflito são
 *   sobrescritos.
 *
 * Robustez: as gravações são aplicadas no cache local imediatamente e a espera
 * pela confirmação do servidor tem teto (ACK_WAIT_TIMEOUT_MS). Assim a operação
 * nunca trava — independentemente do tamanho do backup — e os dados já ficam
 * disponíveis no app; o que faltar sincroniza em segundo plano.
 */
export async function restoreBackup(
  backup: BackupFile,
  opts: { wipeExisting: boolean } = { wipeExisting: true },
  onProgress?: (p: RestoreProgress) => void
): Promise<RestoreResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuario nao autenticado.');
  const uid = user.uid;

  const deleted: Record<string, number> = {};
  const written: Record<string, number> = {};

  const totalToWrite = USER_COLLECTIONS.reduce(
    (sum, name) => sum + (backup.collections[name]?.length || 0),
    0
  );
  let writtenSoFar = 0;
  const allCommits: Promise<void>[] = [];

  for (const name of USER_COLLECTIONS) {
    const colRef = collection(db, 'users', uid, name);

    if (opts.wipeExisting) {
      onProgress?.({ phase: 'reading', collection: name, written: writtenSoFar, totalToWrite });
      // Leitura com teto: se o servidor não responder, caímos para o cache
      // local em vez de travar. Se nem o cache tiver, seguimos sem apagar —
      // como regravamos cada doc por id, docs do backup são sobrescritos de
      // qualquer forma (só sobrariam órfãos fora do backup, caso raro).
      let existing: QuerySnapshot | null = null;
      try {
        existing = await withTimeout(getDocs(colRef), READ_TIMEOUT_MS);
      } catch {
        try { existing = await getDocsFromCache(colRef); } catch { existing = null; }
      }

      if (existing && !existing.empty) {
        onProgress?.({ phase: 'deleting', collection: name, written: writtenSoFar, totalToWrite });
        const deleteOps = existing.docs.map((d) => (batch: ReturnType<typeof writeBatch>) => {
          batch.delete(doc(db, 'users', uid, name, d.id));
        });
        const delCommits = await fireInChunks(deleteOps);
        allCommits.push(...delCommits);
        deleted[name] = existing.size;
      } else {
        deleted[name] = 0;
      }
    } else {
      deleted[name] = 0;
    }

    const items = backup.collections[name] || [];
    const writeOps = items.map((item) => (batch: ReturnType<typeof writeBatch>) => {
      const data = deserializeValue(item.data) as Record<string, unknown>;
      batch.set(doc(db, 'users', uid, name, item.id), data);
    });
    const writeCommits = await fireInChunks(writeOps, (chunkSize) => {
      writtenSoFar += chunkSize;
      onProgress?.({ phase: 'writing', collection: name, written: writtenSoFar, totalToWrite });
    });
    allCommits.push(...writeCommits);
    written[name] = items.length;
  }

  // Restaura entradas de localStorage (best effort).
  let lsCount = 0;
  if (backup.localStorage) {
    for (const [k, v] of Object.entries(backup.localStorage)) {
      try {
        localStorage.setItem(k, v);
        lsCount++;
      } catch {
        // ignora erros de escrita
      }
    }
  }

  // Confirmação REAL de gravação no servidor. waitForPendingWrites só resolve
  // quando TODAS as escritas pendentes (de todas as coleções) foram
  // reconhecidas pelo backend — é a garantia que faltava. Com teto de tempo:
  // se a sincronização travar, não penduramos; os dados já estão no cache local
  // e retornamos serverAckComplete=false pra avisar com honestidade que ainda
  // não subiu tudo (o indicador de sync mostra o mesmo).
  onProgress?.({ phase: 'syncing', written: totalToWrite, totalToWrite });
  let serverAckComplete = false;
  try {
    await withTimeout(waitForPendingWrites(db), ACK_WAIT_TIMEOUT_MS);
    serverAckComplete = true;
  } catch {
    serverAckComplete = false;
  }

  // Conta rejeições já observadas, sem pendurar caso algo ainda esteja em voo.
  const settled = await Promise.race([
    Promise.allSettled(allCommits),
    new Promise<null>((r) => setTimeout(() => r(null), 200)),
  ]);
  const failedChunks = Array.isArray(settled)
    ? settled.filter((r) => r.status === 'rejected').length
    : 0;

  onProgress?.({ phase: 'done', written: totalToWrite, totalToWrite });
  return { deleted, written, localStorageKeys: lsCount, serverAckComplete, failedChunks };
}

export function readBackupFile(file: File): Promise<BackupFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const parsed = JSON.parse(text);
        resolve(validateBackup(parsed));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('JSON invalido.'));
      }
    };
    reader.readAsText(file);
  });
}

import {
  collection,
  getDocs,
  writeBatch,
  doc,
  Timestamp,
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
// Tokens like anthropic/pluggy credentials are intentionally included so a
// full restore brings the app back exactly where it was.
const LOCAL_STORAGE_KEYS = [
  'anthropic_api_key',
  'pluggy_client_id',
  'pluggy_client_secret',
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
}

// Firestore limits a batch to 500 operations — chunk accordingly.
const BATCH_LIMIT = 450;

async function commitInChunks(operations: Array<(batch: ReturnType<typeof writeBatch>) => void>) {
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + BATCH_LIMIT);
    for (const op of chunk) op(batch);
    await batch.commit();
  }
}

/**
 * Restore a backup file.
 *
 * - wipeExisting=true (recommended for disaster recovery): deletes every
 *   document in each user collection before writing the backup, so the final
 *   state matches the file exactly.
 * - wipeExisting=false: merges by document id. Conflicting ids are overwritten.
 */
export async function restoreBackup(
  backup: BackupFile,
  opts: { wipeExisting: boolean } = { wipeExisting: true }
): Promise<RestoreResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuario nao autenticado.');
  const uid = user.uid;

  const deleted: Record<string, number> = {};
  const written: Record<string, number> = {};

  for (const name of USER_COLLECTIONS) {
    const colRef = collection(db, 'users', uid, name);

    if (opts.wipeExisting) {
      const existing = await getDocs(colRef);
      const deleteOps = existing.docs.map((d) => (batch: ReturnType<typeof writeBatch>) => {
        batch.delete(doc(db, 'users', uid, name, d.id));
      });
      await commitInChunks(deleteOps);
      deleted[name] = existing.size;
    } else {
      deleted[name] = 0;
    }

    const items = backup.collections[name] || [];
    const writeOps = items.map((item) => (batch: ReturnType<typeof writeBatch>) => {
      const data = deserializeValue(item.data) as Record<string, unknown>;
      batch.set(doc(db, 'users', uid, name, item.id), data);
    });
    await commitInChunks(writeOps);
    written[name] = items.length;
  }

  // Restore localStorage entries (best effort).
  let lsCount = 0;
  if (backup.localStorage) {
    for (const [k, v] of Object.entries(backup.localStorage)) {
      try {
        localStorage.setItem(k, v);
        lsCount++;
      } catch {
        // ignore write errors
      }
    }
  }

  return { deleted, written, localStorageKeys: lsCount };
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

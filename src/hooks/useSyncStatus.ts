import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { USER_COLLECTIONS } from '../lib/backup';

export type SyncState = 'synced' | 'pending' | 'offline';

// Indicador de sincronização confiável: em vez de "achar" que salvou, lemos o
// próprio sinal do Firestore. Cada snapshot de coleção expõe
// `metadata.hasPendingWrites` = existe escrita local ainda NÃO confirmada pelo
// servidor. Enquanto isso for verdade em qualquer coleção, há algo por subir.
// Combinado com o estado de rede, viram três estados que o usuário enxerga:
//   - offline  : sem rede; mudanças ficam só neste aparelho até reconectar
//   - pending  : conectado, mas ainda há escrita não confirmada (subindo)
//   - synced   : nada pendente — está tudo no servidor
export function useSyncStatus(): SyncState {
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    const pendingByCol: Record<string, boolean> = {};
    const recompute = () => setPending(Object.values(pendingByCol).some(Boolean));

    const stopAuth = onAuthStateChanged(auth, (u) => {
      unsubs.forEach((fn) => fn());
      unsubs = [];
      for (const k of Object.keys(pendingByCol)) delete pendingByCol[k];
      recompute();
      if (!u) return;

      for (const name of USER_COLLECTIONS) {
        const ref = collection(db, 'users', u.uid, name);
        const unsub = onSnapshot(
          ref,
          { includeMetadataChanges: true },
          (snap) => {
            pendingByCol[name] = snap.metadata.hasPendingWrites;
            recompute();
          },
          () => {
            // erro de permissão/rede: não trava o indicador
            pendingByCol[name] = false;
            recompute();
          }
        );
        unsubs.push(unsub);
      }
    });

    return () => {
      stopAuth();
      unsubs.forEach((fn) => fn());
    };
  }, []);

  if (!online) return 'offline';
  return pending ? 'pending' : 'synced';
}

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistência offline do Firestore (fluxo real: categorizar sem rede e
// fechar o navegador antes de reconectar). Com o cache persistente, escritas
// pendentes ficam numa fila durável no IndexedDB e sobrevivem ao fechamento
// do navegador — na próxima abertura com internet, o SDK as envia sozinho.
// Sem isso, a fila vivia só em memória e morria com a aba.
//
// - persistentMultipleTabManager: o app pode ficar aberto em 2+ abas (cenário
//   já tratado no parecer C5); o cache é compartilhado e sincronizado entre
//   elas, sem o erro 'failed-precondition' do modo single-tab.
// - Fallback: se o IndexedDB não estiver utilizável (ex.: modo privado de
//   browsers antigos), o próprio SDK degrada para cache em memória com um
//   warning no console. O try/catch cobre qualquer falha síncrona de
//   inicialização por excesso de zelo: o app nunca pode quebrar por causa
//   do cache — sem persistência ele volta ao comportamento anterior.
// - Trade-off consciente: dados financeiros ficam cacheados no IndexedDB do
//   browser (não criptografado), escopados por origem e por uid. Dispositivo
//   pessoal + trade-off padrão de PWA financeiro; limpar dados do site apaga
//   o cache.
function createDb(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      // Conexão robusta: o transporte de streaming (WebChannel) padrão do
      // Firestore é bloqueado por vários proxies/redes/extensões. Quando isso
      // acontece, as LEITURAS ainda vêm do cache, mas as ESCRITAS ficam presas
      // na fila local e NUNCA sobem — o indicador fica "Salvando…" pra sempre e
      // o trabalho "some" ao recarregar/trocar de aparelho. long-polling usa
      // requisições HTTP comuns pro mesmo servidor e atravessa esses bloqueios.
      // Forçado (não só auto-detect) porque o bloqueio aqui é reproduzível e a
      // pequena latência a mais é irrelevante para um app financeiro pessoal.
      experimentalForceLongPolling: true,
    });
  } catch {
    // Instância default sem localCache configurado = cache em memória
    // (comportamento pré-mudança). Escritas offline voltam a ser voláteis,
    // mas o app funciona.
    return getFirestore(app);
  }
}

export const db: Firestore = createDb();

// Service worker enxuto para PWA.
// Estratégia conservadora (app em iteração ativa): network-first para navegação
// (deploys novos aparecem na hora), cache-first para assets estáticos com
// atualização em segundo plano. Requisições cross-origin (Firebase, Anthropic,
// WhatsApp) NUNCA são cacheadas — passam direto. Nenhum dado financeiro entra
// no Cache Storage: só GET same-origin de assets/navegação; toda leitura de
// dados é Firestore (cross-origin) ou rota /api (POST) — ambos ignorados aqui.

// BUILD_ID é injetado no build (vite.config.ts → plugin swBuildId). Muda a cada
// deploy, então: (1) o byte-content do sw.js muda → o navegador detecta um SW
// novo e dispara install/activate; (2) o nome do cache é versionado → o activate
// apaga TODOS os caches de versões anteriores em vez de deixá-los crescer para
// sempre. Em dev o placeholder fica literal (cache estável), suficiente.
const BUILD_ID = '__BUILD_ID__';
const CACHE = `planejador-${BUILD_ID}`;
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  // skipWaiting: o SW novo não espera todas as abas fecharem para assumir — era
  // exatamente esse o motivo de o deploy novo não chegar ao Guilherme. Seguro
  // aqui porque a navegação é network-first (sem estado de app preso no shell) e
  // o cliente recarrega de forma controlada no controllerchange.
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Remove QUALQUER cache que não seja o desta build (inclui o planejador-v1
      // legado e builds anteriores) — o Cache Storage não cresce sem limite.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Permite forçar a troca imediata a partir do cliente, se algum dia for preciso.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // POST /api (parse/suggest) nunca é cacheado
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin (Firestore/Anthropic): não intercepta
  // Defesa extra: mesmo GET, rotas de dados/API passam direto (sem cache).
  if (url.pathname.startsWith('/api/')) return;

  // Navegações (HTML): network-first, cai para o cache offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Assets estáticos: cache-first + revalidação em segundo plano.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Dirige o ImportModal montado no mini-runtime (stubs/react.mjs) como o
// usuário dirigiria: solta um arquivo, espera o preview, ajusta o que a tela
// deixa ajustar e clica em Importar. O `onImport` é um coletor — nada é gravado
// em lugar nenhum. A leitura por IA (`/api/parse-statement`) é substituída por
// uma resposta fixa: o que se compara é tudo o que vem DEPOIS dela.

/** Nomes dos `useState` na ordem em que o componente os chama — é a ordem dos
 *  slots do mini-runtime. Lida do próprio fonte, para o driver não depender de
 *  a refatoração manter os índices. */
export function stateNames(source) {
  return [...source.matchAll(/const \[(\w+), set\w+\] = useState/g)].map((m) => m[1]);
}

function walk(node, visit) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  if (node.props) {
    visit(node);
    walk(node.props.children, visit);
  }
}

export async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

export function mountImport(loaded, props) {
  const captured = { onImport: [], onSaveFxWallet: [] };
  const inst = loaded.__mount(loaded.ImportModal, {
    existingTransactions: [],
    onClose: () => {},
    ...props,
    onImport: async (items) => { captured.onImport.push(items); },
    onSaveFxWallet: async (currency, snap) => { captured.onSaveFxWallet.push({ currency, snap }); },
  });
  const names = stateNames(loaded.source);
  const slot = (name) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`estado "${name}" não existe no componente`);
    return inst.states[i];
  };
  const find = (pred) => {
    let hit = null;
    walk(inst.tree, (n) => { if (!hit && pred(n)) hit = n; });
    return hit;
  };
  return {
    inst,
    captured,
    get: (name) => slot(name).value,
    set: async (name, value) => { slot(name).set(value); await settle(); },
    async drop(file) {
      const zone = find((n) => typeof n.props.onDrop === 'function');
      if (!zone) throw new Error('área de soltar arquivo não encontrada');
      zone.props.onDrop({ preventDefault() {}, dataTransfer: { files: [file] } });
      await settle();
    },
    async clickImport() {
      const btn = find((n) => typeof n.props.onClick === 'function' && n.props.onClick.name === 'handleImport');
      if (!btn) throw new Error('botão Importar não encontrado');
      await btn.props.onClick();
      await settle();
    },
  };
}

/** Troca `fetch`, `localStorage` e o console enquanto `fn` roda. O fetch
 *  devolve a resposta fixa da "IA" e registra que foi chamado — qualquer outro
 *  endereço é recusado (nenhuma rede de verdade). */
export async function withBrowserFakes(aiResponse, fn) {
  const saved = { fetch: globalThis.fetch, ls: globalThis.localStorage, log: console.log, warn: console.warn };
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (url !== '/api/parse-statement') throw new Error(`rede recusada no teste: ${url}`);
    return new Response(JSON.stringify(aiResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const store = new Map([['anthropic_api_key', 'chave-falsa-de-teste']]);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.ls === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved.ls;
    console.log = saved.log;
    console.warn = saved.warn;
  }
}

/** Serialização estável para comparar: datas viram texto local + ISO, chave
 *  presente com `undefined` fica visível (o Firestore recusa `undefined`, então
 *  a PRESENÇA da chave é comportamento), e a ordem das chaves é normalizada. */
export function canon(v) {
  if (v === undefined) return '$undefined';
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) return `$num:${v}`;
    if (Object.is(v, -0)) return '$num:-0'; // o JSON perderia o sinal
    return v;
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? '$date:invalid' : `$date:${v.toISOString()}`;
  if (v instanceof Set) return { $set: [...v].map(canon).sort() };
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [canon(k), canon(x)]) };
  if (Array.isArray(v)) return v.map(canon);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
  return out;
}

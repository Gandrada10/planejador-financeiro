// Mini-runtime de hooks para rodar o ImportModal fora do navegador, sem DOM e
// sem React. Existe para a caracterização da importação (tests/import): o
// componente ORIGINAL (master) e o refatorado rodam pelo mesmo caminho, e o que
// se compara é o que cada um entrega ao `onImport` e ao preview.
//
// Fiel ao que importa para o resultado: estado por posição de chamada,
// closures do render (um handler assíncrono lê o estado do render em que foi
// criado, como no React), useMemo/useEffect por dependências, efeitos rodando
// depois do render e re-render até estabilizar. Não renderiza componentes
// filhos: a árvore guarda só o que o próprio ImportModal devolve.

let current = null;

function depsChanged(prev, next) {
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) if (!Object.is(prev[i], next[i])) return true;
  return false;
}

export function __mount(Component, props) {
  const inst = {
    Component, props, states: [], memos: [], effects: [], refs: [],
    tree: null, dirty: false, scheduled: false, rendering: false, renders: 0,
  };
  inst.flush = () => {
    inst.scheduled = false;
    let guard = 0;
    do {
      inst.dirty = false;
      render(inst);
      if (++guard > 100) throw new Error('re-render sem fim no mini-runtime');
    } while (inst.dirty);
  };
  inst.flush();
  return inst;
}

function render(inst) {
  inst.rendering = true;
  inst.idx = { s: 0, m: 0, e: 0, r: 0 };
  inst.pending = [];
  current = inst;
  try {
    inst.tree = inst.Component(inst.props);
  } finally {
    current = null;
    inst.rendering = false;
  }
  inst.renders++;
  for (const slot of inst.pending) {
    if (slot.cleanup) slot.cleanup();
    const c = slot.fn();
    slot.cleanup = typeof c === 'function' ? c : null;
  }
}

function schedule(inst) {
  inst.dirty = true;
  if (inst.rendering || inst.scheduled) return;
  inst.scheduled = true;
  queueMicrotask(() => inst.flush());
}

export function useState(initial) {
  const inst = current;
  const i = inst.idx.s++;
  if (!(i in inst.states)) {
    const slot = { value: typeof initial === 'function' ? initial() : initial };
    slot.set = (v) => {
      const next = typeof v === 'function' ? v(slot.value) : v;
      if (Object.is(next, slot.value)) return;
      slot.value = next;
      schedule(inst);
    };
    inst.states[i] = slot;
  }
  const slot = inst.states[i];
  return [slot.value, slot.set];
}

export function useMemo(fn, deps) {
  const inst = current;
  const i = inst.idx.m++;
  const slot = inst.memos[i];
  if (!slot || depsChanged(slot.deps, deps)) {
    inst.memos[i] = { value: fn(), deps };
  }
  return inst.memos[i].value;
}

export function useCallback(fn, deps) {
  return useMemo(() => fn, deps);
}

export function useEffect(fn, deps) {
  const inst = current;
  const i = inst.idx.e++;
  const slot = inst.effects[i] ?? (inst.effects[i] = { deps: undefined, cleanup: null, ran: false });
  if (!slot.ran || deps === undefined || depsChanged(slot.deps, deps)) {
    slot.deps = deps;
    slot.ran = true;
    slot.fn = fn;
    inst.pending.push(slot);
  }
}
export const useLayoutEffect = useEffect;

export function useRef(initial) {
  const inst = current;
  const i = inst.idx.r++;
  if (!(i in inst.refs)) inst.refs[i] = { current: initial };
  return inst.refs[i];
}

export const Fragment = Symbol.for('stub.fragment');
export function createElement(type, props, ...children) {
  return { type, props: { ...(props || {}), children } };
}
export default { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, Fragment, createElement };

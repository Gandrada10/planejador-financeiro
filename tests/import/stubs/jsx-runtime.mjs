// jsx() do mini-runtime: devolve o elemento como dado, sem renderizar.
import { Fragment } from './react.mjs';
export { Fragment };
export function jsx(type, props, key) {
  return { type, props: props || {}, key };
}
export const jsxs = jsx;
export const jsxDEV = jsx;

// Roda os cenários sintéticos contra uma árvore e compara (ou grava) o
// resultado fixado.
//
//   TZ=America/Sao_Paulo node tests/import/run.mjs --ref master --write-golden
//       fixa o comportamento do master em tests/import/golden.json (única
//       escrita deste script, e só com a bandeira explícita)
//   TZ=America/Sao_Paulo node tests/import/run.mjs [--ref <commit>]
//       compara a árvore de trabalho (ou o commit) com o golden
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { REPO, exportRef, loadComponent, loadPure, loadOriginalPure } from './bundle.mjs';
import { runAll } from './scenarios.mjs';

export const GOLDEN = path.join(REPO, 'tests', 'import', 'golden.json');
export const TZ = 'America/Sao_Paulo';

export function assertTz() {
  if (process.env.TZ !== TZ) {
    throw new Error(`rode com TZ=${TZ}: as datas do app são locais (meio-dia) e o resultado depende do fuso`);
  }
}

export async function runTree({ ref } = {}) {
  const root = ref ? exportRef(ref) : REPO;
  const label = ref ? ref.replace(/\W/g, '_') : 'worktree';
  const component = await loadComponent(root, label);
  const pure = ref
    ? { impl: 'original', fns: await loadOriginalPure(root) }
    : await loadPure(root);
  if (ref && fs.existsSync(path.join(root, 'src', 'lib', 'importDedupe.ts'))) {
    pure.impl = 'lib';
    pure.fns = (await loadPure(root)).fns;
  }
  const result = await runAll(component, pure.fns);
  return { impl: pure.impl, result };
}

export function diffKeys(a, b) {
  const out = [];
  for (const sec of ['components', 'pure']) {
    const keys = new Set([...Object.keys(a[sec] ?? {}), ...Object.keys(b[sec] ?? {})]);
    for (const k of keys) if (!isDeepStrictEqual(a[sec]?.[k], b[sec]?.[k])) out.push(`${sec}: ${k}`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertTz();
  const args = process.argv.slice(2);
  const refIdx = args.indexOf('--ref');
  const ref = refIdx >= 0 ? args[refIdx + 1] : undefined;
  const { impl, result } = await runTree({ ref });
  if (args.includes('--write-golden')) {
    if (!ref) throw new Error('o golden só se grava a partir de um commit (--ref), nunca da árvore de trabalho');
    fs.writeFileSync(GOLDEN, JSON.stringify({ fixedFrom: ref, result }, null, 1) + '\n');
    console.log(`golden gravado a partir de ${ref} (funções puras: ${impl})`);
  } else {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    const diffs = diffKeys(golden.result, result);
    console.log(`árvore: ${ref ?? 'trabalho'} · funções puras: ${impl} · golden de ${golden.fixedFrom}`);
    console.log(diffs.length ? `DIFERENTE em ${diffs.length}:\n  ${diffs.join('\n  ')}` : 'IGUAL ao golden em todos os cenários');
    process.exitCode = diffs.length ? 1 : 0;
  }
}

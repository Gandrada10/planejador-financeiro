// Caracterização da importação: o comportamento do ImportModal do master,
// fixado em golden.json, tem de sair igual da árvore de trabalho — pelo
// componente inteiro (cenários A–D) e por cada função pura, uma a uma.
//
//   npm run test:import
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REPO, loadComponent, loadPure } from './bundle.mjs';
import { componentScenarios, pureCases } from './scenarios.mjs';
import { canon } from './driver.mjs';
import { GOLDEN, assertTz } from './run.mjs';

const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
let component;
let pure;

before(async () => {
  assertTz();
  component = await loadComponent(REPO, 'worktree');
  pure = await loadPure(REPO);
});

test('golden fixado a partir de um commit, não da árvore de trabalho', () => {
  assert.ok(golden.fixedFrom && golden.fixedFrom !== 'worktree');
});

test('todo cenário do golden ainda existe (nenhum some calado)', () => {
  assert.deepEqual(Object.keys(componentScenarios).sort(), Object.keys(golden.result.components).sort());
  assert.deepEqual(Object.keys(pureCases).sort(), Object.keys(golden.result.pure).sort());
});

for (const [name, run] of Object.entries(componentScenarios)) {
  test(`componente · ${name}`, async () => {
    const got = await run(component);
    assert.deepStrictEqual(got, golden.result.components[name]);
  });
}

for (const [name, run] of Object.entries(pureCases)) {
  test(`função pura · ${name}`, () => {
    assert.deepStrictEqual(canon(run(pure.fns)), golden.result.pure[name]);
  });
}

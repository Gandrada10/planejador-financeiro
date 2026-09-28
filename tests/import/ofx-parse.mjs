// parseOfx da árvore de trabalho, empacotado para o teste da lib.
import { REPO } from './bundle.mjs';
import { rolldown } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-ofx-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const out = path.join(dir, 'ofx.mjs');
const b = await rolldown({ input: path.join(REPO, 'src', 'lib', 'parseOfx.ts'), platform: 'node', logLevel: 'silent' });
await b.write({ file: out, format: 'esm' });
await b.close();
export const { parseOfx } = await import(pathToFileURL(out).href);

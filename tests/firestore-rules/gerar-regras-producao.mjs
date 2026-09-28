// Gera o texto de PRODUCAO das firestore.rules trocando os marcadores
// __OPERADOR_UID__ e __DONO_UID__ pelos UIDs reais, FORA do repositorio
// (que e publico). Nao publica nada: so escreve o arquivo (0600) e imprime o
// sha256 para o usuario conferir antes de colar no console.
//
// Uso: node gerar-regras-producao.mjs <operador.json> <saida.rules>
//   operador.json precisa ter `operador_uid` e `dono_uid`.
// Recusa: UID fora do formato, UIDs iguais, marcador sobrando, saida dentro
// do repositorio, saida ja existente.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const RULES = resolve(REPO, 'firestore.rules');

function fail(msg) {
  console.error(`RECUSADO: ${msg}`);
  process.exit(2);
}

const [uidsPath, outPath] = process.argv.slice(2);
if (!uidsPath || !outPath) fail('uso: node gerar-regras-producao.mjs <operador.json> <saida.rules>');

const out = resolve(outPath);
const rel = relative(REPO, out);
if (!rel.startsWith('..') && !isAbsolute(rel)) fail('a saida nao pode ficar dentro do repositorio');
if (existsSync(out)) fail('a saida ja existe; apague ou escolha outro nome');

const cfg = JSON.parse(readFileSync(resolve(uidsPath), 'utf8'));
const op = cfg.operador_uid;
const owner = cfg.dono_uid;
const UID = /^[A-Za-z0-9]{20,128}$/;
if (typeof op !== 'string' || !UID.test(op)) fail('operador_uid ausente ou fora do formato');
if (typeof owner !== 'string' || !UID.test(owner)) fail('dono_uid ausente ou fora do formato');
if (op === owner) fail('operador_uid igual ao dono_uid: confira o UID da conta do operador no console');

const src = readFileSync(RULES, 'utf8');
for (const m of ['__OPERADOR_UID__', '__DONO_UID__']) {
  if (!src.includes(`'${m}'`)) fail(`marcador ${m} nao encontrado no firestore.rules`);
}
const text = src.replaceAll('__OPERADOR_UID__', op).replaceAll('__DONO_UID__', owner);
if (/__[A-Z_]+_UID__/.test(text)) fail('sobrou marcador no texto gerado');

writeFileSync(out, text, { mode: 0o600, flag: 'wx' });
const sha = createHash('sha256').update(text, 'utf8').digest('hex');
const shaSrc = createHash('sha256').update(src, 'utf8').digest('hex');
console.log(`gerado: ${out}`);
console.log(`sha256 (texto de producao, com UIDs): ${sha}`);
console.log(`sha256 (firestore.rules do repo, com marcadores): ${shaSrc}`);

// Empacota o código de importação para rodar em Node, sem navegador e sem
// gravar nada: o ImportModal (de uma árvore qualquer — o master exportado ou a
// árvore de trabalho) com o mini-runtime de hooks no lugar do React, e as
// funções puras da importação (extraídas do componente original por AST, ou
// importadas de `src/lib`).
//
// Os pacotes saem numa pasta temporária do sistema e são apagados no fim do
// processo. Nada é escrito dentro do repositório.
import { rolldown } from 'rolldown';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
const STUBS = path.join(HERE, 'stubs');
const COMPONENT = path.join('src', 'components', 'transactions', 'ImportModal.tsx');

const tmpRoots = [];
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

/** Cópia da `src/` da árvore de trabalho numa pasta temporária — para quando
 *  o código ainda não commitado precisa ser lido pelo extrator por AST, que
 *  grava um arquivo ao lado do componente (e nunca deve gravar no repositório). */
export function snapshotWorkingTree() {
  const root = tmpDir('import-wt-');
  fs.cpSync(path.join(REPO, 'src'), path.join(root, 'src'), { recursive: true });
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'));
  return root;
}

/** Árvore `src/` de um commit, exportada para uma pasta temporária (sem tocar
 *  no índice, no ramo nem na árvore de trabalho). */
export function exportRef(ref) {
  const root = tmpDir('import-ref-');
  const tar = execFileSync('git', ['-C', REPO, 'archive', ref, 'src'], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', root], { input: tar });
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'));
  return root;
}

function lucideNames(srcRoot) {
  const names = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const txt = fs.readFileSync(p, 'utf8');
        for (const m of txt.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
          for (const n of m[1].split(',')) {
            const name = n.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '');
            if (name) names.add(name);
          }
        }
      }
    }
  };
  walk(path.join(srcRoot, 'src'));
  return [...names];
}

function stubPlugin(srcRoot) {
  return {
    name: 'import-test-stubs',
    resolveId(source) {
      if (source === 'react') return path.join(STUBS, 'react.mjs');
      if (source === 'react/jsx-runtime' || source === 'react/jsx-dev-runtime') return path.join(STUBS, 'jsx-runtime.mjs');
      if (source === 'react-dom') return path.join(STUBS, 'react-dom.mjs');
      if (source === 'pdfjs-dist') return path.join(STUBS, 'pdfjs.mjs');
      if (source.endsWith('?url')) return '\0url-stub';
      if (source === 'lucide-react') return '\0lucide-stub';
      return null;
    },
    load(id) {
      if (id === '\0url-stub') return 'export default "";';
      if (id === '\0lucide-stub') {
        const names = lucideNames(srcRoot);
        return `const Icon = () => null;\nexport { ${names.map((n) => `Icon as ${n}`).join(', ')} };`;
      }
      return null;
    },
  };
}

async function bundleEntry(entry, srcRoot, label) {
  const out = path.join(tmpDir(`import-bundle-${label}-`), 'bundle.mjs');
  const bundle = await rolldown({
    input: entry,
    platform: 'node',
    plugins: [stubPlugin(srcRoot)],
    logLevel: 'silent',
  });
  await bundle.write({ file: out, format: 'esm' });
  await bundle.close();
  return import(pathToFileURL(out).href);
}

/** O ImportModal de uma árvore, pronto para `__mount`. Devolve também o texto
 *  do componente: a ordem dos `useState` sai dele (ver driver.mjs). */
export async function loadComponent(srcRoot, label) {
  const file = path.join(srcRoot, COMPONENT);
  const entry = path.join(tmpDir('import-entry-'), 'entry.mjs');
  fs.writeFileSync(entry, [
    `export { ImportModal } from ${JSON.stringify(file)};`,
    `export { __mount } from ${JSON.stringify(path.join(STUBS, 'react.mjs'))};`,
  ].join('\n'));
  const mod = await bundleEntry(entry, srcRoot, label);
  return { ...mod, source: fs.readFileSync(file, 'utf8') };
}

/**
 * Funções puras do ImportModal ORIGINAL, tiradas VERBATIM por AST (o padrão
 * "extrair verbatim" do CLAUDE.md): tudo o que está no topo do arquivo menos o
 * componente, as Props e o efeito colateral do pdf.js. O arquivo gerado mora
 * ao lado do original, na árvore EXPORTADA (temporária), para os imports
 * relativos resolverem igual.
 */
export async function loadOriginalPure(srcRoot) {
  if (path.resolve(srcRoot) === REPO) srcRoot = snapshotWorkingTree();
  const file = path.join(srcRoot, COMPONENT);
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keep = [];
  const exported = [];
  for (const st of sf.statements) {
    const src = text.slice(st.getFullStart(), st.getEnd());
    if (ts.isFunctionDeclaration(st)) {
      const name = st.name?.text;
      if (name === 'ImportModal') continue;
      keep.push(src);
      exported.push(name);
    } else if (ts.isVariableStatement(st)) {
      keep.push(src);
      for (const d of st.declarationList.declarations) exported.push(d.name.getText(sf));
    } else if (ts.isImportDeclaration(st) || ts.isTypeAliasDeclaration(st)) {
      keep.push(src);
    } else if (ts.isInterfaceDeclaration(st)) {
      continue; // Props: só tipo, e do componente
    } else if (ts.isExpressionStatement(st)) {
      continue; // pdfjsLib.GlobalWorkerOptions.workerSrc = ... (efeito de tela)
    } else {
      throw new Error(`declaração de topo não prevista no ImportModal original: ${ts.SyntaxKind[st.kind]}`);
    }
  }
  keep.push(`\nexport { ${exported.join(', ')} };\n`);
  const gen = path.join(path.dirname(file), '__pure_original.tsx');
  fs.writeFileSync(gen, keep.join(''));
  return bundleEntry(gen, srcRoot, 'pure-original');
}

/** As mesmas funções, vindas de `src/lib` (a árvore refatorada). */
export async function loadLibPure(srcRoot) {
  const lib = path.join(srcRoot, 'src', 'lib');
  const entry = path.join(tmpDir('import-entry-'), 'entry.mjs');
  fs.writeFileSync(entry, [
    `export * from ${JSON.stringify(path.join(lib, 'importDedupe.ts'))};`,
    `export * from ${JSON.stringify(path.join(lib, 'importMapping.ts'))};`,
  ].join('\n'));
  return bundleEntry(entry, srcRoot, 'pure-lib');
}

/** `lib` quando a árvore já tem os módulos extraídos; senão, o original. */
export async function loadPure(srcRoot) {
  const hasLib = fs.existsSync(path.join(srcRoot, 'src', 'lib', 'importDedupe.ts'));
  return { impl: hasLib ? 'lib' : 'original', fns: hasLib ? await loadLibPure(srcRoot) : await loadOriginalPure(srcRoot) };
}

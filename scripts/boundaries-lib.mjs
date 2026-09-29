import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mts)$/.test(name) && !name.endsWith('.d.ts') ? [p] : [];
  });
}

const PDF_LIBS = /^(pdf-lib|pdfjs-dist)(\/|$)/;
const REACT = /^react(-dom)?(\/|$)/;

/**
 * Regras de dependência entre camadas (ver ARCHITECTURE.md, "Fronteiras"). Devolve a lista de violações.
 *  core      -> só código dentro de core (nada de bibliotecas, React, DOM adapters, node:*)
 *  features  -> sem pdf-lib/pdfjs-dist; de src/pdf só o arquivo de tipos renderer-port
 *  pdf       -> sem React, features ou app
 *  services  -> sem React, features ou app
 *  app       -> composição: sem restrições
 */
export function checkBoundaries(srcRoot) {
  const violations = [];
  for (const file of walk(srcRoot)) {
    const rel = relative(srcRoot, file).split(sep);
    const layer = rel[0];
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const isRelative = spec.startsWith('.');
      const target = isRelative ? relative(srcRoot, resolve(dirname(file), spec)).split(sep) : null;
      const targetLayer = target?.[0];
      const where = `${rel.join('/')} importa "${spec}"`;
      const fail = (why) => violations.push(`${where}: ${why}`);

      if (layer === 'core') {
        if (!isRelative) fail('core não pode importar pacotes externos ou builtins');
        else if (targetLayer !== 'core') fail('core não pode importar de fora de src/core');
      } else if (layer === 'features') {
        if (PDF_LIBS.test(spec)) fail('features não pode importar bibliotecas de PDF');
        if (targetLayer === 'pdf' && target?.[1]?.replace(/\.(ts|tsx)$/, '') !== 'renderer-port') fail('features só pode importar a porta src/pdf/renderer-port');
        if (targetLayer === 'app') fail('features não pode importar de app');
      } else if (layer === 'pdf') {
        if (REACT.test(spec)) fail('pdf não pode importar React');
        if (targetLayer === 'features' || targetLayer === 'app') fail(`pdf não pode importar de ${targetLayer}`);
      } else if (layer === 'services') {
        if (REACT.test(spec) || PDF_LIBS.test(spec)) fail('services não pode importar React nem bibliotecas de PDF');
        if (targetLayer === 'features' || targetLayer === 'app' || targetLayer === 'pdf') fail(`services não pode importar de ${targetLayer}`);
      }
    }
  }
  return violations;
}

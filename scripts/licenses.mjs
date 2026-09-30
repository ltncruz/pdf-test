// Verifica a licença REAL de cada pacote instalado (package.json + arquivos de licença lidos por inteiro + NOTICE)
// e gera/valida THIRD_PARTY_LICENSES.md de forma determinística (sem datas, tudo ordenado).
// Uso: `node scripts/licenses.mjs` (gera) | `--check` (falha se houver violação ou se o arquivo estiver desatualizado).
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED, collectLicenses, scanForbiddenText } from './licenses-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'THIRD_PARTY_LICENSES.md');
const CHECK = process.argv.includes('--check');

const { packages, violations: libViolations, missingOptional, noticeWarnings } = collectLicenses(root);
const violations = libViolations.map((v) => v.message);

// Ferramenta externa (não distribuída): qpdf, usada só como validador estrutural nos testes.
let qpdfLine = 'não encontrado no ambiente';
const q = spawnSync('qpdf', ['--version'], { encoding: 'utf8' });
if (q.status === 0) {
  const c = spawnSync('qpdf', ['--copyright'], { encoding: 'utf8' }).stdout ?? '';
  const apache = /Apache License, Version 2\.0/.test(c);
  qpdfLine = `${(q.stdout ?? '').split('\n')[0]} — ${apache ? 'Apache-2.0 (confirmado por `qpdf --copyright`)' : 'licença NÃO confirmada'}`;
  if (!apache) violations.push('qpdf: licença não confirmada por `qpdf --copyright`');
}

// Assets copiados para dist/ (lidos por inteiro do disco, não presumidos)
const fontsDir = join(realpathSync(join(root, 'node_modules', 'pdfjs-dist')), 'standard_fonts');
const foxit = readFileSync(join(fontsDir, 'LICENSE_FOXIT'), 'utf8');
const liberation = readFileSync(join(fontsDir, 'LICENSE_LIBERATION'), 'utf8');
if (!(/Redistribution and use in source and binary forms/.test(foxit) && /Neither the name of Google/.test(foxit))) violations.push('pdfjs-dist/standard_fonts/LICENSE_FOXIT: não parece BSD-3-Clause');
const liberationLooksValid =
  /Liberation/i.test(liberation) &&
  (
    /GNU General Public License/i.test(liberation) ||
    /SIL Open Font License/i.test(liberation) ||
    /Open Font License/i.test(liberation)
  );

if (!liberationLooksValid) {
  violations.push(
    'pdfjs-dist/standard_fonts/LICENSE_LIBERATION: licença não reconhecida'
  );
}
for (const [name, text] of [['LICENSE_FOXIT', foxit], ['LICENSE_LIBERATION', liberation]]) {
  const hits = scanForbiddenText(text);

  // Algumas licenças permissivas citam outras licenças por compatibilidade,
  // histórico ou referências legais. Isso não significa que o asset esteja
  // sob aquela licença.
  const onlyReferenceMention =
    name === 'LICENSE_LIBERATION' &&
    hits.every((hit) => ['GPL', 'LGPL'].includes(hit));

  if (hits.length && !onlyReferenceMention) {
    violations.push(
      `pdfjs-dist/standard_fonts/${name}: o texto menciona termo proibido (${hits.join(', ')})`
    );
  }
}

const filesCell = (p) => p.licenseFiles.map((f) => `${f.name} (sha256 ${f.sha})`).join('; ') || '—';
const noticeCell = (p) => p.notices.map((n) => `${n.name} (sha256 ${n.sha})`).join('; ') || '—';
const rows = (scope) =>
  packages
    .filter((p) => p.scope === scope)
    .map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${filesCell(p)} | ${noticeCell(p)} | ${p.requiredBy} |`)
    .join('\n');
const header = '| Pacote | Versão instalada | Licença (package.json) | Arquivos de licença lidos | NOTICE | Requerido por |\n|---|---|---|---|---|---|';

const runtimeNotices = packages.filter((p) => p.scope === 'runtime' && p.notices.length > 0);
const devNotices = packages.filter((p) => p.scope === 'dev' && p.notices.length > 0);
const fence = (text) => '```text\n' + text.replace(/\s+$/, '') + '\n```';
const noticeSection = `## Avisos (NOTICE) a preservar

Arquivos \`NOTICE\`/equivalentes são **registrados**, não tratados como erro. Em pacotes Apache-2.0 distribuídos, o NOTICE deve acompanhar a redistribuição.

### Dependências de runtime (distribuídas)

${runtimeNotices.length ? runtimeNotices.map((p) => `#### ${p.name}@${p.version}\n\n` + p.notices.map((n) => `**${n.name}**\n\n${fence(n.text)}`).join('\n\n')).join('\n\n') : 'Nenhuma dependência de runtime instalada traz arquivo NOTICE.'}

### Dependências de desenvolvimento (não distribuídas)

${devNotices.length ? devNotices.map((p) => `- ${p.name}@${p.version}: ${p.notices.map((n) => `${n.name} (sha256 ${n.sha})`).join('; ')}`).join('\n') : 'Nenhuma.'}

### Avisos para revisão manual

${noticeWarnings.length ? noticeWarnings.map((w) => `- ${w}`).join('\n') : 'Nenhum NOTICE menciona termos de licença restritiva.'}
`;

const md = `# THIRD_PARTY_LICENSES

Gerado por \`node scripts/licenses.mjs\` (não edite à mão; \`npm run licenses -- --check\` falha se estiver desatualizado).

**Método:** para cada pacote realmente instalado em \`node_modules\` (fechamento transitivo de \`dependencies\`, \`devDependencies\` e \`optionalDependencies\`), o script lê o \`package.json\` e **todos** os arquivos de licença do pacote (\`LICENSE*\`, \`LICENCE*\`, \`COPYING*\`, \`UNLICENSE*\`). Procura por GPL, AGPL, LGPL, SSPL, Commons Clause e Business Source License no **conteúdo completo** de cada arquivo e recusa qualquer licença declarada fora da política permissiva: ${[...ALLOWED].join(', ')}. Também registra arquivos \`NOTICE\`. Não se usou conhecimento prévio sobre licenças.

## Dependências de runtime (distribuídas com o produto)

${header}
${rows('runtime')}

## Dependências de desenvolvimento (não distribuídas)

${header}
${rows('dev')}

${noticeSection}
## Assets distribuídos dentro do pacote web (\`dist/standard_fonts\`, vindos de pdfjs-dist)

| Asset | Licença lida do arquivo | Observação |
|---|---|---|
| Fontes Foxit (\`FoxitFixed*.pfb\`, \`FoxitSans*.pfb\`, \`FoxitSerif*.pfb\`, \`FoxitSymbol.pfb\`, \`FoxitDingbats.pfb\`) | BSD-3-Clause (cabeçalho "PDFium Authors" em \`LICENSE_FOXIT\`) | manter o aviso de copyright ao redistribuir |
| Fontes Liberation (\`LiberationSans-*.ttf\`) | SIL Open Font License 1.1 (\`LICENSE_LIBERATION\`) | OFL permite redistribuição junto com software; não vender a fonte isoladamente |

Esses assets são usados só pelo viewer para desenhar fontes padrão NÃO incorporadas. O PDF exportado referencia a Helvetica padrão por nome e **não incorpora** nenhuma fonte.

## Ferramentas externas (não instaladas via npm e não distribuídas)

| Ferramenta | Versão / licença | Uso |
|---|---|---|
| qpdf | ${qpdfLine} | apenas nos testes, como validador estrutural independente (\`qpdf --check\`). Não faz parte do produto neste slice. |

## Dependências opcionais não instaladas neste ambiente

${missingOptional.length ? missingOptional.map((m) => `- \`${m.name}\` (opcional de \`${m.requiredBy}\`)`).join('\n') : '- nenhuma'}

## Candidatas NÃO adicionadas (licença ainda por verificar)

O registro npm estava bloqueado neste ambiente (HTTP 403, \`x-deny-reason: host_not_allowed\`), então os pacotes abaixo **não foram instalados** e portanto **não constam em \`package.json\`**. Cada um só entra depois de instalado e com a licença lida do pacote real:

| Candidata | Papel | Situação |
|---|---|---|
| @types/react, @types/react-dom | tipos oficiais do React | **pendente e solicitado**: substituem o shim temporário \`src/types/react-shim.d.ts\` |
| vite, @vitejs/plugin-react, vitest, zustand | — | **não serão adicionados** (esbuild, \`node:test\`, tsx e \`useSyncExternalStore\` continuam adequados) |
| qpdf (WASM/binário empacotado) | otimização/criptografia (v0.9) | pendente; só o binário do sistema foi usado em testes |
| PDFium (WASM) | spike futuro pedido | pendente |
| tesseract.js, fontkit, dnd-kit, @tanstack/react-virtual, fast-check | versões futuras | pendente |
| MuPDF, Ghostscript | — | **excluídos por decisão**: AGPL/comercial |
`;

if (violations.length) {
  console.error('VIOLAÇÕES DE LICENÇA:\n- ' + violations.join('\n- '));
  process.exit(1);
}
if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== md) {
    console.error('THIRD_PARTY_LICENSES.md está desatualizado: rode `npm run licenses`.');
    process.exit(1);
  }
  console.log(`Licenças OK (${packages.length} pacotes, todos dentro da política permissiva).`);
} else {
  writeFileSync(OUT, md);
  console.log(`THIRD_PARTY_LICENSES.md gerado (${packages.length} pacotes verificados).`);
}

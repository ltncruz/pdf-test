// Núcleo testável do scanner de licenças. A CLI (licenses.mjs) só monta o relatório em cima disto.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Política: só licenças permissivas. */
export const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Zlib', 'BlueOak-1.0.0', 'OFL-1.1']);

/** Termos que indicam copyleft forte/rede ou licenças não permissivas. Procurados no CONTEÚDO COMPLETO dos arquivos de licença. */
export const FORBIDDEN_PATTERNS = [
  { name: 'AGPL', re: /GNU\s+AFFERO\s+GENERAL\s+PUBLIC\s+LICENSE|\bAGPL\b/i },
  { name: 'LGPL', re: /GNU\s+(?:LESSER|LIBRARY)\s+GENERAL\s+PUBLIC\s+LICENSE|\bLGPL\b/i },
  { name: 'GPL', re: /GNU\s+GENERAL\s+PUBLIC\s+LICENSE|\bGPL\b/i },
  { name: 'SSPL', re: /SERVER\s+SIDE\s+PUBLIC\s+LICENSE|\bSSPL\b/i },
  { name: 'Commons Clause', re: /COMMONS\s+CLAUSE/i },
  { name: 'Business Source License', re: /BUSINESS\s+SOURCE\s+LICENSE/i },
];

const FORBIDDEN_DECLARED = /^(?:A|L)?GPL|^SSPL|^BUSL|^Commons-Clause/i;
const LICENSE_FILE_RE = /^(licen[sc]e|copying|unlicense)/i;
const NOTICE_FILE_RE = /^(notice|third[-_ ]?party[-_ ]?notices?)/i;

export const sha12 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Nomes de termos proibidos encontrados em QUALQUER posição do texto. */
export function scanForbiddenText(text) {
  return FORBIDDEN_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

/** Classifica a licença declarada (expressão SPDX simples). */
export function classifyDeclared(license) {
  const tokens = String(license ?? '').split(/\s+(?:AND|OR)\s+|[()]/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0 || tokens.includes('UNKNOWN')) return { status: 'unknown', bad: ['(ausente)'] };
  const forbidden = tokens.filter((t) => FORBIDDEN_DECLARED.test(t));
  if (forbidden.length) return { status: 'forbidden', bad: forbidden };
  const unknown = tokens.filter((t) => !ALLOWED.has(t));
  if (unknown.length) return { status: 'unknown', bad: unknown };
  return { status: 'ok', bad: [] };
}

export function declaredLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(' OR ');
  return 'UNKNOWN';
}

function resolvePkg(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return realpathSync(dirname(candidate));
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readTexts(dir, re) {
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .sort()
    .map((name) => {
      const text = readFileSync(join(dir, name), 'utf8');
      return { name, text, sha: sha12(text) };
    });
}

/**
 * Percorre o fechamento transitivo (dependencies, devDependencies do projeto, optionalDependencies) do que está
 * INSTALADO em node_modules e devolve pacotes, violações e opcionais ausentes. Ordem determinística.
 */
export function collectLicenses(projectRoot) {
  const rootPkg = readJson(join(projectRoot, 'package.json'));
  const found = new Map();
  const missingOptional = [];
  const violations = [];

  const visit = (name, fromDir, scope, requiredBy, optional) => {
    const dir = resolvePkg(name, fromDir);
    if (!dir) {
      if (optional) missingOptional.push({ name, requiredBy });
      else violations.push({ package: name, code: 'NOT_INSTALLED', message: `${name}: dependência não instalada (requerida por ${requiredBy})` });
      return;
    }
    const pkg = readJson(join(dir, 'package.json'));
    const key = `${pkg.name}@${pkg.version}`;
    const existing = found.get(key);
    if (existing) {
      if (scope === 'runtime') existing.scope = 'runtime';
      return;
    }
    found.set(key, {
      key, name: pkg.name, version: pkg.version, license: declaredLicense(pkg), scope, requiredBy,
      licenseFiles: readTexts(dir, LICENSE_FILE_RE), notices: readTexts(dir, NOTICE_FILE_RE),
    });
    for (const dep of Object.keys(pkg.dependencies ?? {}).sort()) visit(dep, dir, scope, key, false);
    for (const dep of Object.keys(pkg.optionalDependencies ?? {}).sort()) visit(dep, dir, scope, key, true);
  };

  for (const name of Object.keys(rootPkg.dependencies ?? {}).sort()) visit(name, projectRoot, 'runtime', '(projeto)', false);
  for (const name of Object.keys(rootPkg.devDependencies ?? {}).sort()) visit(name, projectRoot, 'dev', '(projeto)', false);

  // Subpacotes de binário por plataforma (@esbuild/linux-x64 etc.) não trazem arquivo próprio: só herdam do PAI
  // se a licença declarada for idêntica e o pai tiver arquivo. O relatório mostra que foi herdado.
  for (const p of found.values()) {
    if (p.licenseFiles.length > 0) continue;
    const parent = found.get(p.requiredBy);
    if (parent && parent.licenseFiles.length > 0 && parent.license === p.license) {
      p.licenseFiles = parent.licenseFiles.map((f) => ({ ...f, name: `${f.name} (herdado de ${parent.name}@${parent.version})` }));
    }
  }

  const noticeWarnings = [];
  for (const p of found.values()) {
    const declared = classifyDeclared(p.license);
    if (declared.status === 'forbidden') {
      violations.push({ package: p.key, code: 'FORBIDDEN_DECLARED', message: `${p.key}: licença declarada proibida (${p.license})` });
    } else if (declared.status === 'unknown') {
      violations.push({ package: p.key, code: 'UNKNOWN_LICENSE', message: `${p.key}: licença desconhecida ou fora da política (${p.license})` });
    }
    if (p.licenseFiles.length === 0) {
      violations.push({ package: p.key, code: 'NO_LICENSE_FILE', message: `${p.key}: sem arquivo de licença no pacote instalado` });
    }
    for (const f of p.licenseFiles) {
      const hits = scanForbiddenText(f.text);
      if (hits.length) violations.push({ package: p.key, code: 'FORBIDDEN_TEXT', message: `${p.key}: o texto de ${f.name} menciona termo proibido (${hits.join(', ')})` });
    }
    for (const n of p.notices) {
      const hits = scanForbiddenText(n.text);
      if (hits.length) noticeWarnings.push(`${p.key}: ${n.name} menciona ${hits.join(', ')} — revisar manualmente (NOTICE não é bloqueado automaticamente)`);
    }
  }

  const packages = [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { packages, violations, missingOptional: missingOptional.sort((a, b) => a.name.localeCompare(b.name)), noticeWarnings: noticeWarnings.sort() };
}

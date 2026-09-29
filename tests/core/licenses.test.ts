import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classifyDeclared, collectLicenses, scanForbiddenText } from '../../scripts/licenses-lib.mjs';

const MIT = `MIT License\n\nCopyright (c) 2024 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.\n`;

interface PkgSpec { version?: string; license?: string | undefined; files?: Record<string, string>; deps?: Record<string, string>; optional?: Record<string, string> }
const roots: string[] = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function project(opts: { deps?: string[]; dev?: string[]; pkgs: Record<string, PkgSpec> }): string {
  const root = mkdtempSync(join(tmpdir(), 'simply-pdf-lic-'));
  roots.push(root);
  const write = (rel: string, content: string): void => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); };
  write('package.json', JSON.stringify({ name: 'proj', version: '1.0.0', dependencies: Object.fromEntries((opts.deps ?? []).map((d) => [d, '*'])), devDependencies: Object.fromEntries((opts.dev ?? []).map((d) => [d, '*'])) }));
  for (const [name, spec] of Object.entries(opts.pkgs)) {
    const pkgJson: Record<string, unknown> = { name, version: spec.version ?? '1.0.0' };
    if (spec.license !== undefined) pkgJson.license = spec.license;
    if (spec.deps) pkgJson.dependencies = spec.deps;
    if (spec.optional) pkgJson.optionalDependencies = spec.optional;
    write(`node_modules/${name}/package.json`, JSON.stringify(pkgJson));
    for (const [file, content] of Object.entries(spec.files ?? {})) write(`node_modules/${name}/${file}`, content);
  }
  return root;
}
const codes = (root: string): string[] => collectLicenses(root).violations.map((v: { code: string }) => v.code);

describe('scanner de licenças', () => {
  it('licença permissiva válida: sem violações e com o arquivo de licença registrado', () => {
    const r = collectLicenses(project({ deps: ['ok'], pkgs: { ok: { license: 'MIT', files: { LICENSE: MIT } } } }));
    assert.deepEqual(r.violations, []);
    assert.equal(r.packages[0]?.licenseFiles[0]?.name, 'LICENSE');
    assert.equal(r.packages[0]?.scope, 'runtime');
  });

  it('termo proibido no FINAL de um arquivo de licença grande é detectado (varredura do conteúdo completo)', () => {
    const big = MIT + 'x'.repeat(5000) + '\n\nPortions of this package are licensed under the GNU General Public License version 3.\n';
    assert.ok(big.indexOf('GNU General') > 2000, 'o termo está além dos primeiros 2000 caracteres');
    const r = collectLicenses(project({ deps: ['tail'], pkgs: { tail: { license: 'MIT', files: { LICENSE: big } } } }));
    assert.deepEqual(r.violations.map((v: { code: string }) => v.code), ['FORBIDDEN_TEXT']);
    assert.match(r.violations[0]!.message, /GPL/);
  });

  it('todos os arquivos de licença do pacote são varridos (LICENSE limpo + LICENSE-MIT com termo proibido)', () => {
    const root = project({ deps: ['multi'], pkgs: { multi: { license: 'MIT', files: { LICENSE: MIT, 'LICENSE-EXTRA.md': MIT + '\nAlso under the Server Side Public License.' } } } });
    assert.deepEqual(codes(root), ['FORBIDDEN_TEXT']);
  });

  it('pacote sem arquivo de licença é violação', () => {
    assert.deepEqual(codes(project({ deps: ['nofile'], pkgs: { nofile: { license: 'MIT' } } })), ['NO_LICENSE_FILE']);
  });

  it('pacote com NOTICE: o NOTICE é registrado (com texto e hash) e NÃO é erro', () => {
    const r = collectLicenses(project({ deps: ['apache'], pkgs: { apache: { license: 'Apache-2.0', files: { LICENSE: 'Apache License\nVersion 2.0, January 2004\n...', 'NOTICE.txt': 'Copyright 2024 ACME\nThis product includes software developed at ACME.\n' } } } }));
    assert.deepEqual(r.violations, []);
    const notice = r.packages[0]!.notices[0]!;
    assert.equal(notice.name, 'NOTICE.txt');
    assert.match(notice.text, /developed at ACME/);
    assert.equal(notice.sha.length, 12);
  });

  it('variações de nome de NOTICE são reconhecidas (NOTICE, NOTICE.md, ThirdPartyNoticeText.txt)', () => {
    const r = collectLicenses(project({ deps: ['n'], pkgs: { n: { license: 'MIT', files: { LICENSE: MIT, NOTICE: 'a', 'NOTICE.md': 'b', 'ThirdPartyNoticeText.txt': 'c' } } } }));
    assert.deepEqual(r.packages[0]!.notices.map((n: { name: string }) => n.name), ['NOTICE', 'NOTICE.md', 'ThirdPartyNoticeText.txt']);
  });

  it('NOTICE que menciona licença restritiva gera apenas AVISO para revisão manual, não violação', () => {
    const r = collectLicenses(project({ deps: ['n'], pkgs: { n: { license: 'MIT', files: { LICENSE: MIT, NOTICE: 'bundles a component under the GNU Lesser General Public License' } } } }));
    assert.deepEqual(r.violations, []);
    assert.equal(r.noticeWarnings.length, 1);
  });

  it('licença desconhecida, ausente ou fora da política é violação', () => {
    for (const license of ['Custom-1.0', 'UNLICENSED', 'SEE LICENSE IN LICENSE.txt', undefined]) {
      const root = project({ deps: ['u'], pkgs: { u: { license, files: { LICENSE: MIT } } } });
      assert.deepEqual(codes(root), ['UNKNOWN_LICENSE'], String(license));
    }
  });

  for (const [label, declared, text] of [
    ['GPL', 'GPL-3.0-only', 'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007'],
    ['AGPL', 'AGPL-3.0-or-later', 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007'],
    ['LGPL', 'LGPL-2.1', 'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1, February 1999'],
    ['SSPL', 'SSPL-1.0', 'Server Side Public License\nVERSION 1, OCTOBER 16, 2018'],
  ] as const) {
    it(`${label}: declarado no package.json => FORBIDDEN_DECLARED`, () => {
      assert.deepEqual(codes(project({ deps: ['x'], pkgs: { x: { license: declared, files: { LICENSE: MIT } } } })), ['FORBIDDEN_DECLARED']);
    });
    it(`${label}: só no TEXTO da licença (package.json diz MIT) => FORBIDDEN_TEXT`, () => {
      assert.deepEqual(codes(project({ deps: ['x'], pkgs: { x: { license: 'MIT', files: { LICENSE: text } } } })), ['FORBIDDEN_TEXT']);
    });
    it(`${label}: identificador SPDX curto no texto também é detectado`, () => {
      assert.ok(scanForbiddenText(`Licensed under ${declared}`).includes(label) || scanForbiddenText(`Licensed under ${declared}`).length > 0);
    });
  }

  it('expressões: "(MIT AND Zlib)" é aceita; "MIT OR GPL-3.0" é recusada (conservador)', () => {
    assert.equal(classifyDeclared('(MIT AND Zlib)').status, 'ok');
    assert.equal(classifyDeclared('MIT OR GPL-3.0').status, 'forbidden');
    assert.equal(classifyDeclared('Apache-2.0').status, 'ok');
  });

  it('não há falso positivo em palavras comuns (upgrade, aggregate, "gplx")', () => {
    assert.deepEqual(scanForbiddenText('We upgrade and aggregate gplx sources; see SSPLIT and LGPLESS.'), []);
  });

  it('dependência transitiva herda o escopo; dev não vira runtime; devDependency compartilhada com runtime vira runtime', () => {
    const root = project({ deps: ['a'], dev: ['b', 'a'], pkgs: { a: { license: 'MIT', files: { LICENSE: MIT }, deps: { c: '*' } }, b: { license: 'MIT', files: { LICENSE: MIT } }, c: { license: 'ISC', files: { LICENSE: 'ISC License' } } } });
    const r = collectLicenses(root);
    assert.deepEqual(r.packages.map((p: { name: string; scope: string }) => `${p.name}:${p.scope}`), ['a:runtime', 'b:dev', 'c:runtime']);
  });

  it('dependência obrigatória ausente é violação; opcional ausente só é registrada', () => {
    const root = project({ deps: ['a'], pkgs: { a: { license: 'MIT', files: { LICENSE: MIT }, deps: { missing: '*' }, optional: { 'plat-bin': '*' } } } });
    const r = collectLicenses(root);
    assert.deepEqual(r.violations.map((v: { code: string }) => v.code), ['NOT_INSTALLED']);
    assert.deepEqual(r.missingOptional.map((m: { name: string }) => m.name), ['plat-bin']);
  });

  it('subpacote de binário sem arquivo próprio herda do pai SÓ com a mesma licença declarada', () => {
    const same = collectLicenses(project({ deps: ['tool'], pkgs: { tool: { license: 'MIT', files: { LICENSE: MIT }, optional: { 'tool-linux': '*' } }, 'tool-linux': { license: 'MIT' } } }));
    assert.deepEqual(same.violations, []);
    assert.match(same.packages.find((p: { name: string }) => p.name === 'tool-linux')!.licenseFiles[0]!.name, /herdado de tool@1\.0\.0/);
    const differ = collectLicenses(project({ deps: ['tool'], pkgs: { tool: { license: 'MIT', files: { LICENSE: MIT }, optional: { 'tool-linux': '*' } }, 'tool-linux': { license: 'ISC' } } }));
    assert.deepEqual(differ.violations.map((v: { code: string }) => v.code), ['NO_LICENSE_FILE']);
  });

  it('a saída é determinística e ordenada por nome', () => {
    const root = project({ deps: ['zeta', 'alpha', 'mid'], pkgs: { zeta: { license: 'MIT', files: { LICENSE: MIT } }, alpha: { license: 'MIT', files: { LICENSE: MIT } }, mid: { license: 'MIT', files: { LICENSE: MIT } } } });
    const a = collectLicenses(root);
    const b = collectLicenses(root);
    assert.deepEqual(a, b);
    assert.deepEqual(a.packages.map((p: { name: string }) => p.name), ['alpha', 'mid', 'zeta']);
  });
});

describe('THIRD_PARTY_LICENSES.md do repositório', () => {
  before(() => undefined);
  it('está em dia com os pacotes instalados (mesma checagem do npm run licenses -- --check)', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['scripts/licenses.mjs', '--check'], { cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

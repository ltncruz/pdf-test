import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkBoundaries } from '../../scripts/boundaries-lib.mjs';

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'simply-pdf-boundaries-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}
const violationsFor = (files: Record<string, string>): string[] => {
  const root = project(files);
  try { return checkBoundaries(root); } finally { rmSync(root, { recursive: true, force: true }); }
};

describe('regras de fronteira entre camadas', () => {
  it('o código real do repositório respeita as fronteiras', () => {
    assert.deepEqual(checkBoundaries(new URL('../../src', import.meta.url).pathname), []);
  });
  it('core não pode importar pdf-lib, pdfjs-dist, React, node:* nem outras camadas', () => {
    const v = violationsFor({
      'core/a.ts': "import { PDFDocument } from 'pdf-lib';\nimport * as x from 'pdfjs-dist';\nimport React from 'react';\nimport fs from 'node:fs';\nimport { y } from '../pdf/pdflib-writer';\nexport * from '../features/viewer/PageCanvas';",
    });
    assert.equal(v.length, 6, v.join('\n'));
  });
  it('core pode importar dentro de core (inclusive import type e dynamic import)', () => {
    assert.deepEqual(violationsFor({ 'core/a.ts': "import type { X } from './b';\nexport * from './b';\nconst m = import('./b');", 'core/b.ts': 'export type X = 1;' }), []);
  });
  it('features não importa bibliotecas de PDF; de src/pdf só a porta renderer-port', () => {
    assert.equal(violationsFor({ 'features/v/A.tsx': "import * as p from 'pdfjs-dist';" }).length, 1);
    assert.equal(violationsFor({ 'features/v/A.tsx': "import { r } from '../../pdf/pdfjs-renderer';" }).length, 1);
    assert.deepEqual(violationsFor({ 'features/v/A.tsx': "import type { PageRenderer } from '../../pdf/renderer-port';" }), []);
  });
  it('pdf e services não importam React/features/app; app é livre', () => {
    assert.equal(violationsFor({ 'pdf/a.ts': "import { useState } from 'react';" }).length, 1);
    assert.equal(violationsFor({ 'pdf/a.ts': "import { A } from '../features/x/A';" }).length, 1);
    assert.equal(violationsFor({ 'services/s.ts': "import { W } from '../pdf/w';" }).length, 1);
    assert.deepEqual(violationsFor({ 'app/w.ts': "import * as p from 'pdfjs-dist';\nimport { A } from '../features/x/A';" }), []);
  });
});

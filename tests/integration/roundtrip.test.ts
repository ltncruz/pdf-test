import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { DocumentSession, ExportError, OpenError, exportDocument, isWinAnsiChar, openDocument, WIN_ANSI_EXTRAS, type DocumentState, type PageId, type TextObject } from '../../src/core';
import { buildSamplePdf, MARKERS } from '../fixtures/fixtures';
import { createTestEnv, nodePdfJs, openSample, type TestEnv } from '../helpers';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const ids = (s: DocumentState): PageId[] => [...s.pageOrder];

function text(env: TestEnv, over: Partial<TextObject> = {}): TextObject {
  return { id: env.ids.object(), kind: 'text', rect: { x: 10, y: 20, w: 200, h: 40 }, text: 'Olá, Simply PDF — teste ção', fontSize: 18, color: { r: 0.8, g: 0, b: 0 }, ...over };
}

/** Reabre o PDF exportado com PDF.js (independente do pdf-lib) e devolve o que interessa. */
async function reopen(bytes: Uint8Array) {
  const doc = await nodePdfJs.getDocument({ data: bytes.slice(), standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const tc = await p.getTextContent();
    const items = tc.items.filter((i): i is (typeof tc.items)[number] & { str: string; transform: number[] } => 'str' in i && i.str.trim() !== '');
    pages.push({ rotate: p.rotate, view: p.view as number[], items: items.map((i) => ({ str: i.str, x: i.transform[4] as number, y: i.transform[5] as number })), text: items.map((i) => i.str).join(' ') });
  }
  await doc.destroy();
  return pages;
}

function qpdfCheck(bytes: Uint8Array): { ok: boolean; npages: number } {
  const dir = mkdtempSync(join(tmpdir(), 'simply-pdf-'));
  try {
    const file = join(dir, 'out.pdf');
    writeFileSync(file, bytes);
    const check = spawnSync('qpdf', ['--check', file], { encoding: 'utf8' });
    const npages = Number(execFileSync('qpdf', ['--show-npages', file], { encoding: 'utf8' }).trim());
    return { ok: check.status === 0, npages };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('caminho primário ponta a ponta (critério de conclusão do núcleo)', () => {
  it('abrir → páginas → alterar → undo → redo → exportar → reabrir → validar', async () => {
    const env = createTestEnv();
    const original = await buildSamplePdf();
    const originalHash = sha(original);
    const state0 = await openSample(env, original);
    assert.equal(state0.pageOrder.length, 3);
    const [p1, p2, p3] = ids(state0) as [PageId, PageId, PageId];
    assert.deepEqual(ids(state0).map((id) => state0.pages[id]?.baseRotation), [0, 90, 0], '/Rotate do arquivo lido corretamente');

    const session = new DocumentSession(state0);
    const label = text(env);
    session.execute({ type: 'page/delete', pageIds: [p2] });
    session.execute({ type: 'page/rotate', pageIds: [p1], delta: 90 });
    session.execute({ type: 'object/add', pageId: p3, object: label });
    const afterEdits = session.getState();

    // undo x3 volta ao estado inicial; redo x3 volta ao final.
    session.undo(); session.undo(); session.undo();
    assert.deepEqual({ ...session.getState(), revision: 0 }, { ...state0, revision: 0 });
    session.redo(); session.redo(); session.redo();
    assert.deepEqual({ ...session.getState(), revision: 0 }, { ...afterEdits, revision: 0 });

    const { bytes, warnings } = await exportDocument(session.getState(), env);
    assert.deepEqual(warnings, []);

    // 1) O original permanece intacto (mesmos bytes, mesmo hash) e o SourceStore também.
    assert.equal(sha(original), originalHash);
    const stored = await env.sources.get(Object.keys(state0.sources)[0] as never);
    assert.equal(sha(stored), originalHash);

    // 2) Reabre o exportado com parser independente e valida o resultado.
    const pages = await reopen(bytes);
    assert.equal(pages.length, 2, 'página 2 foi excluída');
    assert.ok(pages[0]?.text.includes(MARKERS[0]), 'página 1 do resultado = PAGE-1');
    assert.ok(pages[1]?.text.includes(MARKERS[2]), 'página 2 do resultado = PAGE-3 (ordem preservada)');
    assert.ok(!pages.some((p) => p.text.includes(MARKERS[1])), 'PAGE-2 não existe mais');
    assert.equal(pages[0]?.rotate, 90, 'rotação do usuário aplicada');
    assert.equal(pages[1]?.rotate, 0);
    assert.deepEqual(pages[1]?.view, [20, 30, 320, 430], 'CropBox deslocada preservada');
    assert.ok(pages[1]?.text.includes('Olá, Simply PDF — teste ção'), 'texto adicionado presente (acentos incluídos)');
    assert.ok(!pages[0]?.text.includes('Olá'), 'texto só na página 3 do original');

    // 3) Posição do texto: contrato de coordenadas (origem topo-esquerda no modelo -> user space).
    const item = pages[1]?.items.find((i) => i.str.startsWith('Olá'));
    assert.ok(item);
    assert.ok(Math.abs(item.x - (20 + 10)) < 0.01, `x=${item.x}`);
    assert.ok(Math.abs(item.y - (30 + 400 - 20 - 18)) < 0.01, `baseline y=${item.y}`);

    // 4) Validação estrutural independente (qpdf --check), quando disponível.
    if (hasQpdf) {
      const q = qpdfCheck(bytes);
      assert.equal(q.ok, true, 'qpdf --check deve passar');
      assert.equal(q.npages, 2);
    }
  });

  it('exportar após desfazer tudo reproduz a estrutura do PDF original', async () => {
    const env = createTestEnv();
    const session = new DocumentSession(await openSample(env, await buildSamplePdf()));
    const [p1, p2] = ids(session.getState()) as [PageId, PageId];
    session.execute({ type: 'page/delete', pageIds: [p1] });
    session.execute({ type: 'page/rotate', pageIds: [p2], delta: 180 });
    session.undo(); session.undo();
    const pages = await reopen((await exportDocument(session.getState(), env)).bytes);
    assert.deepEqual(pages.map((p) => p.rotate), [0, 90, 0]);
    assert.deepEqual(pages.map((p) => MARKERS.find((m) => p.text.includes(m))), [...MARKERS]);
  });

  it('rotação do usuário soma com o /Rotate do arquivo (90 + 90 = 180; + 270 = 0)', async () => {
    const env = createTestEnv();
    const s = new DocumentSession(await openSample(env, await buildSamplePdf()));
    const p2 = ids(s.getState())[1] as PageId;
    s.execute({ type: 'page/rotate', pageIds: [p2], delta: 90 });
    assert.equal((await reopen((await exportDocument(s.getState(), env)).bytes))[1]?.rotate, 180);
    s.execute({ type: 'page/rotate', pageIds: [p2], delta: 270 });
    assert.equal((await reopen((await exportDocument(s.getState(), env)).bytes))[1]?.rotate, 90);
  });

  it('página em branco inserida é exportada com tamanho e texto corretos', async () => {
    const env = createTestEnv();
    const s = new DocumentSession(await openSample(env, await buildSamplePdf()));
    const blankId = env.ids.page();
    s.execute({ type: 'batch', ops: [
      { type: 'page/insert', items: [{ index: 1, page: { id: blankId, origin: { kind: 'blank' }, crop: { x: 0, y: 0, w: 595.28, h: 841.89 }, baseRotation: 0, rotation: 0, objects: [] } }] },
      { type: 'object/add', pageId: blankId, object: text(env, { text: 'em branco' }) },
    ] });
    const pages = await reopen((await exportDocument(s.getState(), env)).bytes);
    assert.equal(pages.length, 4);
    assert.deepEqual(pages[1]?.view.map((n) => Math.round(n * 100) / 100), [0, 0, 595.28, 841.89]);
    assert.equal(pages[1]?.text, 'em branco');
  });

  it('texto multilinha e com quebra por largura é gravado por inteiro', async () => {
    const env = createTestEnv();
    const s = new DocumentSession(await openSample(env, await buildSamplePdf()));
    const p1 = ids(s.getState())[0] as PageId;
    s.execute({ type: 'object/add', pageId: p1, object: text(env, { text: 'primeira linha\nsegunda linha bem longa que precisa quebrar dentro da caixa', rect: { x: 72, y: 72, w: 150, h: 100 } }) });
    const pages = await reopen((await exportDocument(s.getState(), env)).bytes);
    assert.ok(pages[0]?.text.replace(/\s+/g, '').includes('primeiralinhasegundalinhabemlongaqueprecisaquebrardentrodacaixa'));
  });
});

describe('editar o texto de uma caixa adicionada', () => {
  it('editar → exportar mostra só o texto novo; desfazer → exportar volta ao antigo; refazer → novo de novo', async () => {
    const env = createTestEnv();
    const session = new DocumentSession(await openSample(env, await buildSamplePdf()));
    const p1 = ids(session.getState())[0] as PageId;
    const box = text(env, { text: 'texto ORIGINAL da caixa', rect: { x: 72, y: 100, w: 300, h: 40 } });
    session.execute({ type: 'object/add', pageId: p1, object: box });
    session.execute({ type: 'object/update', pageId: p1, objectId: box.id, patch: { text: 'texto EDITADO com acentos: ação — ok', fontSize: 22 } });
    const edited = await reopen((await exportDocument(session.getState(), env)).bytes);
    assert.ok(edited[0]!.text.includes('texto EDITADO com acentos: ação — ok'));
    assert.ok(!edited[0]!.text.includes('ORIGINAL'));
    const item = edited[0]!.items.find((i) => i.str.startsWith('texto EDITADO'))!;
    assert.ok(Math.abs(item.y - (792 - 100 - 22)) < 0.01, `a linha de base acompanha o novo tamanho de fonte (y=${item.y})`);
    session.undo();
    const back = await reopen((await exportDocument(session.getState(), env)).bytes);
    assert.ok(back[0]!.text.includes('texto ORIGINAL da caixa') && !back[0]!.text.includes('EDITADO'));
    session.redo();
    const again = await reopen((await exportDocument(session.getState(), env)).bytes);
    assert.ok(again[0]!.text.includes('EDITADO'));
  });
  it('texto editado para algo que a fonte não codifica é barrado no preflight (estado do documento permanece editável)', async () => {
    const env = createTestEnv();
    const session = new DocumentSession(await openSample(env, await buildSamplePdf()));
    const p1 = ids(session.getState())[0] as PageId;
    const box = text(env);
    session.execute({ type: 'object/add', pageId: p1, object: box });
    session.execute({ type: 'object/update', pageId: p1, objectId: box.id, patch: { text: '日本語' } });
    await assert.rejects(exportDocument(session.getState(), env), (e: unknown) => e instanceof ExportError && e.failure.stage === 'preflight');
    session.undo();
    await exportDocument(session.getState(), env);
  });
});

describe('falhas tratadas', () => {
  it('bytes que não são PDF viram OpenError e nada é guardado no SourceStore', async () => {
    const env = createTestEnv();
    await assert.rejects(openDocument({ name: 'x.pdf', bytes: new TextEncoder().encode('isto não é um pdf') }, env), OpenError);
    assert.equal(env.sources.size, 0);
  });
  it('texto que a fonte padrão não codifica aborta o export antes de gerar arquivo', async () => {
    const env = createTestEnv();
    const s = new DocumentSession(await openSample(env, await buildSamplePdf()));
    s.execute({ type: 'object/add', pageId: ids(s.getState())[0] as PageId, object: text(env, { text: '日本語' }) });
    await assert.rejects(exportDocument(s.getState(), env), (e: unknown) => e instanceof ExportError && e.failure.stage === 'preflight');
  });
  it('origem removida do SourceStore é detectada no preflight', async () => {
    const env = createTestEnv();
    const state = await openSample(env, await buildSamplePdf());
    const empty = { ...env, sources: { has: async () => false, get: async () => { throw new Error('x'); }, put: async () => {}, delete: async () => {} } };
    await assert.rejects(exportDocument(state, empty), (e: unknown) => e instanceof ExportError && e.failure.stage === 'preflight');
  });
});

describe('consistência core <-> pdf-lib', () => {
  it('todo caractere que isWinAnsiChar aceita é codificável pela Helvetica do pdf-lib', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const failures: string[] = [];
    const candidates = [...Array.from({ length: 0x100 }, (_, i) => i), ...WIN_ANSI_EXTRAS];
    for (const cp of candidates) {
      const ch = String.fromCodePoint(cp);
      if (!isWinAnsiChar(ch)) continue;
      try { font.encodeText(ch); } catch { failures.push(`U+${cp.toString(16)}`); }
    }
    assert.deepEqual(failures, []);
  });
});

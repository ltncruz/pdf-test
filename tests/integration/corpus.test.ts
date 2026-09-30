/**
 * Corpus de compatibilidade: para cada tipo de PDF, o comportamento EXPLÍCITO da versão atual
 * (abre / edita / exporta / preserva / limitação), sempre conferindo que o original não foi alterado.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib';
import { DocumentSession, ExportError, OpenError, exportDocument, resolveLimits, type DocumentState, type PageId, type SourceInfo } from '../../src/core';
import { createPdfJsSourceReader } from '../../src/pdf/pdfjs-reader';
import { buildSamplePdf, MARKERS } from '../fixtures/fixtures';
import * as C from '../fixtures/corpus';
import { createTestEnv, nodePdfJs, openSample, sha256, type TestEnv } from '../helpers';

const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
function qpdfOk(bytes: Uint8Array): boolean {
  if (!hasQpdf) return true;
  const dir = mkdtempSync(join(tmpdir(), 'simply-pdf-corpus-'));
  try {
    writeFileSync(join(dir, 'o.pdf'), bytes);
    return spawnSync('qpdf', ['--check', join(dir, 'o.pdf')]).status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const fontsUrl = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname;
async function withPdfJs<T>(
  bytes: Uint8Array,
  fn: (doc: Awaited<ReturnType<typeof nodePdfJs.getDocument>['promise']>) => Promise<T>
): Promise<T> {

  const task = nodePdfJs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: fontsUrl,
  });

  const doc = await task.promise;

  try {
    return await fn(doc);
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
const pageIds = (s: DocumentState): PageId[] => [...s.pageOrder];
const textBox = (env: TestEnv, text: string, rect = { x: 30, y: 30, w: 250, h: 40 }) => ({ id: env.ids.object(), kind: 'text' as const, rect, text, fontSize: 14, color: { r: 0, g: 0, b: 0.5 } });

/** Executa: abrir -> ops -> exportar (verificado) e confere que o original permanece intacto. */
async function editAndExport(bytes: Uint8Array, edit: (s: DocumentSession, env: TestEnv) => void = () => {}) {
  const env = createTestEnv();
  const before = sha256(bytes);
  const session = new DocumentSession(await openSample(env, bytes));
  edit(session, env);
  const result = await exportDocument(session.getState(), env);
  assert.equal(sha256(bytes), before, 'o PDF original não pode ser alterado');
  const stored = await env.sources.get(Object.keys(session.getState().sources)[0] as never);
  assert.equal(sha256(stored), before, 'o SourceStore guarda os bytes originais');
  assert.ok(qpdfOk(result.bytes), 'qpdf --check deve passar');
  return { env, session, ...result };
}

describe('MediaBox ≠ CropBox, CropBox com origem não zero, /Rotate explícito', () => {
  it('abre com a caixa visível correta, edita (texto + rotação) e exporta preservando a CropBox', async () => {
    const bytes = await C.buildMediaCropBox();
    const { env, session, bytes: out } = await editAndExport(bytes, (s, e) => {
      const [p] = pageIds(s.getState()) as [PageId];
      s.execute({ type: 'object/add', pageId: p, object: textBox(e, 'na caixa recortada') });
      s.execute({ type: 'page/rotate', pageIds: [p], delta: 90 });
    });
    const page = session.getState().pages[session.getState().pageOrder[0]!]!;
    assert.deepEqual(page.crop, { x: 50, y: 60, w: 400, h: 600 });
    const insp = await env.inspector.inspect(out);
    assert.deepEqual([insp.pages[0]!.x, insp.pages[0]!.y, insp.pages[0]!.width, insp.pages[0]!.height, insp.pages[0]!.rotation], [50, 60, 400, 90 * 0 + 600, 90]);
    assert.match(insp.pages[0]!.text, /CROP-MARKER/);
    // texto adicionado: canto superior esquerdo da CropBox + (30,30) => x = 80, linha de base y = 60 + 600 - 30 - 14
    const t = insp.pages[0]!.items.find((i) => i.str.startsWith('na caixa'))!;
    assert.ok(Math.abs(t.x - 80) < 0.01 && Math.abs(t.y - 616) < 0.01, `${t.x},${t.y}`);
  });
});

describe('atributos herdados da árvore de páginas (MediaBox, CropBox, Rotate, Resources)', () => {
  it('lê os atributos herdados, exporta com atributos explícitos e aplica rotação do usuário sobre o /Rotate herdado', async () => {
    const bytes = await C.buildInherited();
    const src = await PDFDocument.load(bytes);
    assert.equal(src.getPage(0).node.has(PDFName.of('Rotate')), false, 'a fixture realmente NÃO define /Rotate na folha');
    assert.equal(src.getPage(0).node.has(PDFName.of('MediaBox')), false);

    const { env, session, bytes: out } = await editAndExport(bytes, (s, e) => {
      const [p1] = pageIds(s.getState()) as [PageId, PageId];
      s.execute({ type: 'page/rotate', pageIds: [p1], delta: 90 });
      s.execute({ type: 'object/add', pageId: p1, object: textBox(e, 'texto herdado') });
    });
    const state = session.getState();
    assert.deepEqual(state.pageOrder.map((id) => [state.pages[id]!.baseRotation, state.pages[id]!.crop]), [[90, { x: 10, y: 20, w: 470, h: 660 }], [90, { x: 10, y: 20, w: 470, h: 660 }]]);
    const insp = await env.inspector.inspect(out);
    assert.deepEqual(insp.pages.map((p) => p.rotation), [180, 90]);
    assert.deepEqual(insp.pages.map((p) => [p.x, p.y, p.width, p.height]), [[10, 20, 470, 660], [10, 20, 470, 660]]);
    assert.deepEqual(insp.pages.map((p) => /INHERIT-\d/.exec(p.text)?.[0]), ['INHERIT-1', 'INHERIT-2']);
    // Exportação materializa os atributos na folha (não depende mais da árvore herdada):
    const dst = await PDFDocument.load(out);
    for (const page of dst.getPages()) {
      for (const key of ['MediaBox', 'CropBox', 'Rotate']) assert.equal(page.node.has(PDFName.of(key)), true, `${key} explícito na folha`);
    }
  });
});

describe('annotations e links', () => {
  const annots = (bytes: Uint8Array) => withPdfJs(bytes, async (d) => {
    const out: { subtype: string; url?: string; hasDest: boolean }[][] = [];
    for (let n = 1; n <= d.numPages; n++) out.push((await (await d.getPage(n)).getAnnotations()).map((a: { subtype: string; url?: string; dest?: unknown }) => ({ subtype: a.subtype, ...(a.url ? { url: a.url } : {}), hasDest: a.dest !== undefined })));
    return out;
  });
  const pageDicts = (doc: PDFDocument) => doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Page')).length;

  it('preserva link externo e anotação de nota; link interno continua apontando para a página copiada (não uma duplicata)', async () => {
    const { bytes: out } = await editAndExport(await C.buildAnnotations());
    const a = await annots(out);
    assert.deepEqual(a[0], [{ subtype: 'Link', url: 'https://example.com/simply-pdf', hasDest: false }, { subtype: 'Text', hasDest: false }]);
    assert.deepEqual(a[1], [{ subtype: 'Link', hasDest: true }]);
    const doc = await PDFDocument.load(out);
    assert.equal(pageDicts(doc), 3, 'nenhuma página duplicada arrastada pelo link');
    const link = doc.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    const dest = link.lookup(PDFName.of('Dest'), PDFArray).get(0);
    assert.ok(dest instanceof PDFRef);
    assert.equal(dest.tag, doc.getPage(2).ref.tag, 'o link da página 2 aponta para a página 3 do arquivo exportado');
  });
  it('excluir a página de destino: o link interno é removido e a página excluída NÃO permanece dentro do arquivo', async () => {
    const { bytes: out, env, session } = await editAndExport(await C.buildAnnotations(), (s) => s.execute({ type: 'page/delete', pageIds: [pageIds(s.getState())[2]!] }));
    const a = await annots(out);
    assert.deepEqual(a.map((x) => x.length), [2, 0], 'link para a página excluída foi removido; os demais preservados');
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 2);
    assert.equal(pageDicts(doc), 2, 'nenhum objeto de página órfão (vazamento do conteúdo da página excluída)');
    const insp = await env.inspector.inspect(out);
    assert.ok(!insp.pages.some((p) => p.text.includes('ANNOT-PAGE-3')));
    assert.equal(session.getState().pageOrder.length, 2);
  });
  it('a mesma página de origem usada duas vezes (duplicação) gera cópias independentes com links próprios', async () => {
    const { bytes: out } = await editAndExport(await C.buildAnnotations(), (s, env) => {
      const st = s.getState();
      const first = st.pages[st.pageOrder[0]!]!;
      s.execute({ type: 'page/insert', items: [{ index: 1, page: { ...first, id: env.ids.page(), objects: [] } }] });
    });
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 4);
    const refs = new Set(doc.getPages().map((p) => p.ref.tag));
    assert.equal(refs.size, 4);
    const a = await annots(out);
    assert.deepEqual(a[0], a[1], 'a cópia tem as mesmas anotações da original');
  });
});

describe('formulário AcroForm', () => {
  it('abre, edita e exporta; a aparência (widgets) é preservada mas os campos deixam de ser interativos — e o usuário é AVISADO', async () => {
    const bytes = await C.buildAcroForm();
    const env = createTestEnv();
    const state = await openSample(env, bytes);
    assert.equal(Object.values(state.sources)[0]!.traits.acroForm, true);
    const { bytes: out, warnings } = await editAndExport(bytes, (s, e) => s.execute({ type: 'object/add', pageId: pageIds(s.getState())[0]!, object: textBox(e, 'texto sobre o formulário') }));
    assert.deepEqual(warnings.map((w) => w.code), ['FORM_NOT_PRESERVED']);
    assert.match(warnings[0]!.message, /NÃO são preservados/);
    await withPdfJs(out, async (d) => {
      const widgets = (await (await d.getPage(1)).getAnnotations()).filter((a: { subtype: string }) => a.subtype === 'Widget');
      assert.equal(widgets.length, 2, 'os dois widgets continuam desenhados');
      assert.equal(await d.getFieldObjects(), null, 'LIMITAÇÃO CONHECIDA: o AcroForm não é copiado (campos não interativos)');
    });
  });
  it('XFA também gera o aviso de formulário não preservado', async () => {
    const bytes = await C.buildXfa();
    const env = createTestEnv();
    const state = await openSample(env, bytes);
    const traits = Object.values(state.sources)[0]!.traits;
    assert.equal(traits.xfa, true);
    const { warnings } = await exportDocument(state, env);
    assert.ok(warnings.some((w) => w.code === 'FORM_NOT_PRESERVED'));
  });
});

describe('assinatura digital', () => {
  it('é detectada na abertura e a exportação avisa que a assinatura NÃO é preservada', async () => {
    const { warnings, session } = await editAndExport(await C.buildSigned());
    assert.equal(Object.values(session.getState().sources)[0]!.traits.signatures, true);
    assert.ok(warnings.some((w) => w.code === 'SIGNATURE_NOT_PRESERVED'));
  });
  it('sem as páginas do PDF assinado no documento, não há aviso (a limitação só vale para origens em uso)', async () => {
    const env = createTestEnv();
    const s = new DocumentSession(await openSample(env, await C.buildSigned()));
    const blank = { id: env.ids.page(), origin: { kind: 'blank' as const }, crop: { x: 0, y: 0, w: 595, h: 842 }, baseRotation: 0 as const, rotation: 0 as const, objects: [] };
    s.execute({ type: 'batch', ops: [{ type: 'page/insert', items: [{ page: blank, index: 1 }] }, { type: 'page/delete', pageIds: [s.getState().pageOrder[0]!] }] });
    const { warnings } = await exportDocument(s.getState(), env);
    assert.deepEqual(warnings, []);
  });
});

describe('imagem, fontes incorporadas e fontes padrão não incorporadas', () => {
  it('imagem: preservada na página exportada', async () => {
    const { bytes: out } = await editAndExport(await C.buildWithImage(), (s) => s.execute({ type: 'page/rotate', pageIds: [pageIds(s.getState())[0]!], delta: 180 }));
    const images = await withPdfJs(out, async (d) => (await (await d.getPage(1)).getOperatorList()).fnArray.filter((f: number) => f === nodePdfJs.OPS.paintImageXObject).length);
    assert.equal(images, 1);
    const doc = await PDFDocument.load(out);
    const hasImageXObject = doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    assert.ok(hasImageXObject);
  });
  it('fonte TrueType incorporada: texto original (com acentos) preservado, fonte continua incorporada, texto novo em Helvetica', async () => {
    const bytes = C.staticFixture('embedded-font.pdf');
    const { bytes: out, env } = await editAndExport(bytes, (s, e) => {
      s.execute({ type: 'page/delete', pageIds: [pageIds(s.getState())[1]!] });
      s.execute({ type: 'object/add', pageId: pageIds(s.getState())[0]!, object: textBox(e, 'Adicionado') });
    });
    const insp = await env.inspector.inspect(out);
    assert.equal(insp.pages.length, 1);
    assert.ok(insp.pages[0]!.text.includes('FONTE-EMBUTIDA-UM'));
    assert.ok(insp.pages[0]!.text.includes('ação coração'));
    const doc = await PDFDocument.load(out);
    const embedded = doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFDict && o.has(PDFName.of('FontFile2')));
    assert.ok(embedded, 'FontFile2 (TrueType incorporada) presente no arquivo exportado');
  });
  it('fonte padrão não incorporada (Helvetica): a fixture base é exatamente isso e passa por todo o pipeline', async () => {
    const bytes = await buildSamplePdf();
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFDict && o.has(PDFName.of('FontFile2'))), false, 'sem fonte incorporada');
    const { env, bytes: out } = await editAndExport(bytes);
    assert.ok((await env.inspector.inspect(out)).pages.map((p) => p.text).join(' ').includes(MARKERS[2]));
  });
  it('as fixtures estáticas não foram alteradas (SHA-256 do MANIFEST.json)', () => {
    const manifest = JSON.parse(readFileSync(new URL('../fixtures/static/MANIFEST.json', import.meta.url), 'utf8')) as Record<string, { bytes: number; sha256: string }>;
    assert.equal(Object.keys(manifest).length, 3);
    for (const [name, m] of Object.entries(manifest)) {
      const b = C.staticFixture(name);
      assert.deepEqual([b.length, sha256(b)], [m.bytes, m.sha256], name);
    }
  });
});

describe('PDF multipágina e com muitas páginas', () => {
  it('250 páginas: abre, exclui/gira várias, exporta e cada página exportada é a certa (identidade por marcador)', async () => {
    const started = Date.now();
    const bytes = await C.buildManyPages(250);
    const env = createTestEnv();
    const session = new DocumentSession(await openSample(env, bytes));
    const ids = pageIds(session.getState());
    assert.equal(ids.length, 250);
    session.execute({ type: 'page/delete', pageIds: [ids[4]!, ids[5]!, ids[100]!, ids[249]!] });
    session.execute({ type: 'page/rotate', pageIds: [ids[0]!, ids[120]!], delta: 270 });
    session.execute({ type: 'object/add', pageId: ids[200]!, object: textBox(env, 'meio do documento') });
    const { bytes: out } = await exportDocument(session.getState(), env);
    const insp = await env.inspector.inspect(out);
    assert.equal(insp.pages.length, 246);
    const removed = new Set([5, 6, 101, 250]);
    const expectedMarkers = Array.from({ length: 250 }, (_, i) => i + 1).filter((n) => !removed.has(n)).map(C.manyPagesMarker);
    assert.deepEqual(insp.pages.map((p) => /MANY-\d{4}/.exec(p.text)?.[0]), expectedMarkers);
    assert.equal(insp.pages[0]!.rotation, 270);
    assert.ok(qpdfOk(out));
    assert.ok(Date.now() - started < 60_000, 'deve rodar em tempo razoável');
  });
  it('PDF multipágina com origens de tamanhos diferentes preserva a ordem e as caixas de cada página', async () => {
    const { bytes: out, env } = await editAndExport(await buildSamplePdf(), (s) => {
      const [a, b, c] = pageIds(s.getState()) as [PageId, PageId, PageId];
      s.execute({ type: 'batch', ops: [{ type: 'page/delete', pageIds: [a, c] }, { type: 'page/insert', items: [{ page: s.getState().pages[a]!, index: 1 }] }] });
      void b;
    });
    const insp = await env.inspector.inspect(out);
    assert.deepEqual(insp.pages.map((p) => [p.width, p.height]), [[595, 842], [612, 792]]);
  });
});

describe('guardrail de páginas no leitor real (PDF.js)', () => {
  it('o limite de páginas é aplicado ANTES de ler qualquer página', async () => {
    const bytes = await C.buildManyPages(30);
    let getPageCalls = 0;
    const spy = {
      ...nodePdfJs,
      getDocument: (params: Parameters<typeof nodePdfJs.getDocument>[0]) => {
        const task = nodePdfJs.getDocument(params);
        return { promise: task.promise.then((d) => { const orig = d.getPage.bind(d); d.getPage = (n: number) => { getPageCalls++; return orig(n); }; return d; }), destroy: () => task.destroy() } as unknown as ReturnType<typeof nodePdfJs.getDocument>;
      },
    } as typeof nodePdfJs;
    const reader = createPdfJsSourceReader(spy, { standardFontDataUrl: fontsUrl });
    await assert.rejects(reader.read(bytes, { maxPages: 10 }), (e: unknown) => (e as { code?: string }).code === 'TOO_MANY_PAGES');
    assert.equal(getPageCalls, 0);
    const info: SourceInfo = await reader.read(bytes, { maxPages: 30 });
    assert.equal(info.pages.length, 30);
  });
  it('openDocument com limites reduzidos falha de forma controlada e não guarda nada', async () => {
    const env = createTestEnv();
    await assert.rejects(
      (await import('../../src/core')).openDocument({ name: 'many.pdf', bytes: await C.buildManyPages(30) }, { ...env, limits: resolveLimits({ maxPages: 10 }) }),
      (e: unknown) => e instanceof OpenError && e.code === 'TOO_MANY_PAGES',
    );
    assert.equal(env.sources.size, 0);
  });
});

describe('PDFs parcialmente inválidos', () => {
  it('lixo ANTES do cabeçalho %PDF e lixo DEPOIS do %%EOF: abre, exporta e o resultado é um PDF válido', async () => {
    const base = await buildSamplePdf();
    const junkBefore = new Uint8Array([...new TextEncoder().encode('HTTP/1.1 200 OK\r\n\r\n'), ...base]);
    const junkAfter = new Uint8Array([...base, ...new Uint8Array(2048)]);
    for (const [name, bytes] of [['lixo antes', junkBefore], ['lixo depois', junkAfter]] as const) {
      const { env, bytes: out } = await editAndExport(bytes);
      assert.equal((await env.inspector.inspect(out)).pages.length, 3, name);
    }
  });
  it('xref/trailer/startxref danificados: rejeitado de forma controlada (INVALID_PDF), nada é guardado', async () => {
    const base = await buildSamplePdf();
    const text = new TextDecoder('latin1').decode(base);
    const latin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
    const variants: [string, Uint8Array][] = [
      ['arquivo truncado', C.truncateTail(base)],
      ['startxref errado', C.corruptStartxref(base)],
      ['sem trailer', latin(text.slice(0, text.lastIndexOf('trailer')))],
      ['/Size errado', latin(text.replace(/\/Size \d+/, '/Size 3'))],
    ];
    for (const [name, bytes] of variants) {
      const env = createTestEnv();
      await assert.rejects(openSample(env, bytes), (e: unknown) => e instanceof OpenError && e.code === 'INVALID_PDF', name);
      assert.equal(env.sources.size, 0, name);
    }
  });
  it('bytes corrompidos no meio: nunca há exceção não controlada nem PDF inválido devolvido', async () => {
    const bytes = C.corruptMiddle(await buildSamplePdf());
    const env = createTestEnv();
    try {
      const state = await openSample(env, bytes);
      try {
        const { bytes: out } = await exportDocument(state, env);
        assert.ok(qpdfOk(out), 'se exportou, o resultado é válido');
      } catch (e) {
        assert.ok(e instanceof ExportError, `esperava ExportError, veio ${String(e)}`);
      }
    } catch (e) {
      assert.ok(e instanceof OpenError && e.code === 'INVALID_PDF', `esperava OpenError(INVALID_PDF), veio ${String(e)}`);
      assert.equal(env.sources.size, 0);
    }
  });
  it('arquivo vazio e texto puro: INVALID_PDF', async () => {
    for (const bytes of [new Uint8Array(0), new TextEncoder().encode('não sou um pdf')]) {
      const env = createTestEnv();
      await assert.rejects(openSample(env, bytes), (e: unknown) => e instanceof OpenError && e.code === 'INVALID_PDF');
      assert.equal(env.sources.size, 0);
    }
  });
});

describe('PDFs criptografados/protegidos', () => {
  it('exige senha para abrir: PASSWORD_REQUIRED, nada guardado', async () => {
    const env = createTestEnv();
    const e = await openSample(env, C.staticFixture('encrypted-user-password.pdf')).then(() => null, (x: unknown) => x);
    assert.ok(e instanceof OpenError && e.code === 'PASSWORD_REQUIRED', String(e));
    assert.match(e.message, /senha/);
    assert.equal(env.sources.size, 0);
  });
  it('abre sem senha mas com restrições de permissão: ENCRYPTED (a exportação não preservaria a proteção), nada guardado', async () => {
    const env = createTestEnv();
    const e = await openSample(env, C.staticFixture('encrypted-owner-only.pdf')).then(() => null, (x: unknown) => x);
    assert.ok(e instanceof OpenError && e.code === 'ENCRYPTED', String(e));
    assert.equal(env.sources.size, 0);
  });
});

void PDFRawStream;

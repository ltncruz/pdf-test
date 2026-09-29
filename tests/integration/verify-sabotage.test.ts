/**
 * Prova que a verificação pós-exportação pega defeitos REAIS do writer: o writer verdadeiro (pdf-lib) recebe um plano
 * adulterado, mas a verificação compara o PDF gerado com o plano ORIGINAL. Cada defeito deve virar ExportError(verify),
 * sem devolver nenhum byte.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSession, ExportError, exportDocument, type ExportPlan, type PageId, type PdfWriter, type VerifyCode } from '../../src/core';
import { createPdfLibWriter } from '../../src/pdf/pdflib-writer';
import { buildSamplePdf } from '../fixtures/fixtures';
import { createTestEnv, openSample, type TestEnv } from '../helpers';

const real = createPdfLibWriter();
const sabotage = (mutate: (plan: ExportPlan) => ExportPlan): PdfWriter => ({ materialize: (plan, sources) => real.materialize(mutate(plan), sources) });

async function prepared(env: TestEnv): Promise<DocumentSession> {
  const session = new DocumentSession(await openSample(env, await buildSamplePdf()));
  const [p1, p2, p3] = session.getState().pageOrder as [PageId, PageId, PageId];
  const box = (n: number, text: string) => ({ id: env.ids.object(), kind: 'text' as const, rect: { x: 30, y: 40 + n * 10, w: 220, h: 60 }, text, fontSize: 16, color: { r: 0, g: 0, b: 0.6 } });
  session.execute({ type: 'object/add', pageId: p1, object: box(0, 'Texto da página um') });
  session.execute({ type: 'object/add', pageId: p3, object: box(1, 'Linha A\nLinha B') });
  session.execute({ type: 'page/rotate', pageIds: [p2], delta: 90 });
  return session;
}

async function failures(writer: PdfWriter): Promise<VerifyCode[]> {
  const env = createTestEnv();
  const session = await prepared(env);
  try {
    await exportDocument(session.getState(), { ...env, writer });
  } catch (e) {
    assert.ok(e instanceof ExportError, String(e));
    assert.equal(e.failure.stage, 'verify');
    return e.failure.issues.map((i) => i.code as VerifyCode);
  }
  assert.fail('a exportação deveria ter sido rejeitada pela verificação');
}

const mapPages = (plan: ExportPlan, f: (p: ExportPlan['pages'][number], i: number) => ExportPlan['pages'][number]): ExportPlan => ({ pages: plan.pages.map(f) });

describe('o writer correto passa na verificação reforçada', () => {
  it('3 páginas, textos em páginas com e sem /Rotate de origem, rotação do usuário e multilinha', async () => {
    const env = createTestEnv();
    const session = await prepared(env);
    const { bytes } = await exportDocument(session.getState(), env);
    assert.ok(bytes.length > 500);
  });
});

describe('defeitos injetados no writer são rejeitados (nenhum byte é devolvido)', () => {
  it('ordem das páginas invertida', async () => {
    const codes = await failures(sabotage((plan) => ({ pages: [...plan.pages].reverse() })));
    assert.ok(codes.includes('PAGE_CONTENT') || codes.includes('PAGE_SIZE'), codes.join());
  });
  it('página de origem errada copiada para a posição 1 (mesmo tamanho, conteúdo diferente)', async () => {
    const codes = await failures(sabotage((plan) => mapPages(plan, (p, i) => (i === 1 && p.source ? { ...p, source: { ...p.source, index: 0 }, crop: plan.pages[0]!.crop } : p))));
    assert.ok(codes.includes('PAGE_CONTENT'), codes.join());
  });
  it('rotação ignorada', async () => {
    assert.ok((await failures(sabotage((plan) => mapPages(plan, (p) => ({ ...p, rotation: 0 }))))).includes('PAGE_ROTATION'));
  });
  it('texto omitido', async () => {
    assert.ok((await failures(sabotage((plan) => mapPages(plan, (p) => ({ ...p, texts: [] }))))).includes('TEXT_MISSING'));
  });
  it('texto gravado em outra página', async () => {
    const codes = await failures(sabotage((plan) => mapPages(plan, (p, i) => (i === 0 ? { ...p, texts: [] } : i === 1 ? { ...p, texts: plan.pages[0]!.texts } : p))));
    assert.ok(codes.includes('TEXT_WRONG_PAGE'), codes.join());
  });
  it('texto deslocado 10 pt para a direita', async () => {
    const codes = await failures(sabotage((plan) => mapPages(plan, (p) => ({ ...p, texts: p.texts.map((t) => ({ ...t, rect: { ...t.rect, x: t.rect.x + 10 } })) }))));
    assert.ok(codes.includes('TEXT_POSITION'), codes.join());
  });
  it('texto deslocado 5 pt para baixo', async () => {
    const codes = await failures(sabotage((plan) => mapPages(plan, (p) => ({ ...p, texts: p.texts.map((t) => ({ ...t, rect: { ...t.rect, y: t.rect.y - 5 } })) }))));
    assert.ok(codes.includes('TEXT_POSITION'), codes.join());
  });
  it('fonte maior que a pedida', async () => {
    const codes = await failures(sabotage((plan) => mapPages(plan, (p) => ({ ...p, texts: p.texts.map((t) => ({ ...t, fontSize: t.fontSize + 3 })) }))));
    assert.ok(codes.includes('TEXT_SIZE'), codes.join());
  });
  it('entrelinha diferente da esperada (texto multilinha)', async () => {
    const codes = await failures(sabotage((plan) => mapPages(plan, (p) => ({ ...p, texts: p.texts.map((t) => ({ ...t, lineHeight: t.lineHeight * 2 })) }))));
    assert.ok(codes.includes('TEXT_LAYOUT'), codes.join());
  });
  it('CropBox com origem alterada', async () => {
    const codes = await failures(sabotage((plan) => mapPages(plan, (p, i) => (i === 2 ? { ...p, crop: { ...p.crop, x: p.crop.x + 5 } } : p))));
    assert.ok(codes.includes('PAGE_BOX'), codes.join());
  });
  it('página a menos', async () => {
    assert.ok((await failures(sabotage((plan) => ({ pages: plan.pages.slice(0, -1) })))).includes('PAGE_COUNT'));
  });
});

/**
 * Corpus de PDFs pequenos e DETERMINÍSTICOS (gerados por código) para os testes de compatibilidade.
 * Fixtures binárias estáticas (fonte incorporada, criptografia) ficam em ./static (ver README lá).
 */
import { deflateSync, crc32 } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts, rgb, type PDFPage } from 'pdf-lib';

export const staticFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./static/${name}`, import.meta.url)));

async function newDoc(): Promise<PDFDocument> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  return pdf;
}
const save = (pdf: PDFDocument): Promise<Uint8Array> => pdf.save({ useObjectStreams: false });

async function mark(pdf: PDFDocument, page: PDFPage, text: string, x: number, y: number): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x, y, size: 18, font, color: rgb(0, 0, 0) });
}

/** MediaBox 600x800 com CropBox [50 60 450 660]: origem não zero e visível diferente da MediaBox. */
export async function buildMediaCropBox(): Promise<Uint8Array> {
  const pdf = await newDoc();
  const page = pdf.addPage([600, 800]);
  page.setCropBox(50, 60, 400, 600);
  await mark(pdf, page, 'CROP-MARKER', 80, 600);
  return save(pdf);
}

/** MediaBox, CropBox, Rotate e Resources herdados da árvore de páginas (nenhuma folha os define). */
export async function buildInherited(): Promise<Uint8Array> {
  const pdf = await newDoc();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages: PDFPage[] = [pdf.addPage([500, 700]), pdf.addPage([500, 700])];
  pages.forEach((p, i) => p.drawText(`INHERIT-${i + 1}`, { x: 60, y: 600, size: 18, font, color: rgb(0, 0, 0) }));
  const ctx = pdf.context;
  const tree = pdf.catalog.lookup(PDFName.of('Pages'), PDFDict);
  const resources = pages[0]!.node.get(PDFName.of('Resources'));
  for (const p of pages) {
    for (const key of ['MediaBox', 'CropBox', 'Rotate', 'Resources']) p.node.delete(PDFName.of(key));
    p.node.set(PDFName.of('Resources'), resources ?? ctx.obj({}));
  }
  // Resources é o mesmo objeto nas duas folhas; move-o para o pai e remove das folhas.
  for (const p of pages) p.node.delete(PDFName.of('Resources'));
  tree.set(PDFName.of('Resources'), resources ?? ctx.obj({}));
  tree.set(PDFName.of('MediaBox'), ctx.obj([0, 0, 500, 700]));
  tree.set(PDFName.of('CropBox'), ctx.obj([10, 20, 480, 680]));
  tree.set(PDFName.of('Rotate'), PDFNumber.of(90));
  return save(pdf);
}

/** 3 páginas: link URI + nota (p1), link interno para a p3 (p2), marcador (p3). */
export async function buildAnnotations(): Promise<Uint8Array> {
  const pdf = await newDoc();
  const [p1, p2, p3] = [pdf.addPage([612, 792]), pdf.addPage([612, 792]), pdf.addPage([612, 792])] as [PDFPage, PDFPage, PDFPage];
  await mark(pdf, p1, 'ANNOT-PAGE-1', 72, 700);
  await mark(pdf, p2, 'ANNOT-PAGE-2', 72, 700);
  await mark(pdf, p3, 'ANNOT-PAGE-3', 72, 700);
  const ctx = pdf.context;
  const uriLink = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 650, 260, 680], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/simply-pdf') } }));
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 650, 320, 670], Contents: PDFHexString.fromText('Nota de teste'), Name: 'Comment', F: 4 }));
  p1.node.set(PDFName.of('Annots'), ctx.obj([uriLink, note]));
  const internal = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 650, 260, 680], Border: [0, 0, 0], Dest: [p3.ref, 'Fit'] }));
  p2.node.set(PDFName.of('Annots'), ctx.obj([internal]));
  return save(pdf);
}

/** Formulário AcroForm simples: campo de texto preenchido + caixa de seleção marcada. */
export async function buildAcroForm(): Promise<Uint8Array> {
  const pdf = await newDoc();
  const page = pdf.addPage([612, 792]);
  await mark(pdf, page, 'FORM-PAGE-1', 72, 720);
  const form = pdf.getForm();
  const name = form.createTextField('nome');
  name.setText('Maria da Silva');
  name.addToPage(page, { x: 72, y: 650, width: 240, height: 24 });
  const ok = form.createCheckBox('aceito');
  ok.check();
  ok.addToPage(page, { x: 72, y: 610, width: 18, height: 18 });
  return save(pdf);
}

/** PNG RGB 16x16 gerado por código (gradiente determinístico). */
export function tinyPng(): Uint8Array {
  const w = 16;
  const h = 16;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set([x * 16, y * 16, 128], y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** 2 páginas: imagem (p1) e texto (p2). */
export async function buildWithImage(): Promise<Uint8Array> {
  const pdf = await newDoc();
  const p1 = pdf.addPage([612, 792]);
  const image = await pdf.embedPng(tinyPng());
  p1.drawImage(image, { x: 72, y: 500, width: 160, height: 160 });
  await mark(pdf, p1, 'IMAGE-PAGE-1', 72, 700);
  const p2 = pdf.addPage([612, 792]);
  await mark(pdf, p2, 'IMAGE-PAGE-2', 72, 700);
  return save(pdf);
}

/** Documento com uma assinatura digital (campo Sig com /V): só o suficiente para o PDF.js reportar IsSignaturesPresent. */
export async function buildSigned(): Promise<Uint8Array> {
  const pdf = await newDoc();
  const page = pdf.addPage([612, 792]);
  await mark(pdf, page, 'SIGNED-PAGE-1', 72, 700);
  const ctx = pdf.context;
  const sig = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Sig1'), Rect: [50, 50, 200, 100], P: page.ref, F: 4,
    V: { Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 0, 0, 0], Contents: PDFHexString.of('00'), M: PDFString.of('D:20240101000000Z') },
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([sig]));
  pdf.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [sig], SigFlags: 3 }));
  return save(pdf);
}

/** Formulário XFA (dinâmico) mínimo: dicionário /XFA no AcroForm. */
export async function buildXfa(): Promise<Uint8Array> {
  const pdf = await newDoc();
  const page = pdf.addPage([612, 792]);
  await mark(pdf, page, 'XFA-PAGE-1', 72, 700);
  const ctx = pdf.context;
  const xdp = ctx.register(ctx.flateStream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"/></xdp:xdp>'));
  pdf.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [], XFA: [PDFString.of('template'), xdp] }));
  return save(pdf);
}

export const manyPagesMarker = (n: number): string => `MANY-${String(n).padStart(4, '0')}`;
/** `count` páginas, cada uma com um marcador único. */
export async function buildManyPages(count: number): Promise<Uint8Array> {
  const pdf = await newDoc();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) pdf.addPage([300, 400]).drawText(manyPagesMarker(i), { x: 30, y: 350, size: 14, font });
  return save(pdf);
}

/** Remove o trailer/startxref/%%EOF: arquivo truncado (comum em downloads interrompidos). */
export function truncateTail(bytes: Uint8Array, dropLastBytes = 120): Uint8Array {
  return bytes.slice(0, bytes.length - dropLastBytes);
}
/** Aponta startxref para um deslocamento errado: xref inválida, objetos íntegros. */
export function corruptStartxref(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder('latin1').decode(bytes);
  const i = text.lastIndexOf('startxref');
  if (i < 0) throw new Error('startxref não encontrado');
  const patched = text.slice(0, i) + 'startxref\n9\n%%EOF\n';
  return Uint8Array.from(patched, (c) => c.charCodeAt(0));
}
/** Um PDF válido com lixo binário no meio de um objeto. */
export function corruptMiddle(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  for (let i = Math.floor(out.length / 2); i < Math.floor(out.length / 2) + 40; i++) out[i] = 0xff;
  return out;
}
export { PDFArray };

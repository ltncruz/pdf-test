import type { DocumentState, ObjectId, Page, PageId, SourceId, TextObject } from '../../src/core';

export const SRC = 'src_1' as SourceId;
export const NO_TRAITS = { acroForm: false, xfa: false, signatures: false } as const;
export const pid = (n: number): PageId => `pg_${n}` as PageId;
export const oid = (n: number): ObjectId => `obj_${n}` as ObjectId;

export function makePage(n: number, over: Partial<Page> = {}): Page {
  return {
    id: pid(n),
    origin: { kind: 'source', sourceId: SRC, index: n - 1 },
    crop: { x: 0, y: 0, w: 612, h: 792 },
    baseRotation: 0,
    rotation: 0,
    objects: [],
    ...over,
  };
}

/** Documento sintético (sem PDFs reais): prova que o core roda sem nenhuma biblioteca de PDF. */
export function makeDoc(count = 3): DocumentState {
  const pages: Record<string, Page> = {};
  const order: PageId[] = [];
  for (let n = 1; n <= count; n++) {
    pages[pid(n)] = makePage(n);
    order.push(pid(n));
  }
  return {
    name: 'doc.pdf',
    sources: { [SRC]: { id: SRC, name: 'doc.pdf', byteLength: 1, pageCount: count, traits: NO_TRAITS } },
    pages,
    pageOrder: order,
    revision: 0,
  };
}

export function makeText(n: number, over: Partial<TextObject> = {}): TextObject {
  return { id: oid(n), kind: 'text', rect: { x: 10, y: 20, w: 100, h: 50 }, text: `texto ${n}`, fontSize: 12, color: { r: 0, g: 0, b: 0 }, ...over };
}

/** `revision` sobe a cada operação; para comparar conteúdo, zere-a. */
export const sansRevision = (s: DocumentState): DocumentState => ({ ...s, revision: 0 });

// ---- dublês do inspetor (verificação pós-exportação) ----
import type { InspectedPage, InspectedTextItem } from '../../src/core';

export const item = (str: string, x: number, y: number, fontSize = 12): InspectedTextItem => ({ str, x, y, fontSize });

/** Página inspecionada Carta 612x792 sem rotação; `text` é derivado de `items` quando não informado. */
export function insp(over: Partial<InspectedPage> = {}): InspectedPage {
  const items = over.items ?? [];
  return { rotation: 0, x: 0, y: 0, width: 612, height: 792, text: items.map((i) => i.str).join(' '), items, ...over };
}

/** Item esperado para makeText(n) na página Carta: rect {10,20,100,50}, fonte 12 => linha de base y=760. */
export const expectedItem = (str: string, over: Partial<InspectedTextItem> = {}): InspectedTextItem => ({ str, x: 10, y: 760, fontSize: 12, ...over });

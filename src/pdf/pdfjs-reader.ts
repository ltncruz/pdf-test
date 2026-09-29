import type * as PdfJsNamespace from 'pdfjs-dist';
import type { InspectedPage, InspectedTextItem, PdfInspector, SourceReader } from '../core/ports';
import { normalizeRotation } from '../core/pages/geometry';
import { SourceReadError } from '../core/document/errors';

/** O módulo pdfjs é injetado (build padrão no navegador, build "legacy" no Node), então este arquivo não importa nada em runtime. */
export type PdfJs = typeof PdfJsNamespace;

type View = [number, number, number, number];

export interface PdfJsOptions {
  /** URL/caminho da pasta standard_fonts do pdfjs-dist (necessária para fontes padrão não embutidas, como Helvetica). */
  readonly standardFontDataUrl?: string;
}

type PdfDoc = PdfJsNamespace.PDFDocumentProxy;

/** Abre o documento e garante que o loading task não vaza quando o carregamento falha. */
async function load(pdfjs: PdfJs, options: PdfJsOptions, bytes: Uint8Array): Promise<PdfDoc> {
  // PDF.js TRANSFERE (destaca) o buffer recebido para o worker: sempre passar uma cópia.
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, ...options });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw error;
  }
}

async function withDocument<T>(pdfjs: PdfJs, options: PdfJsOptions, bytes: Uint8Array, fn: (doc: PdfDoc) => Promise<T>): Promise<T> {
  const doc = await load(pdfjs, options, bytes);
  try {
    return await fn(doc);
  } finally {
    await doc.destroy();
  }
}

/** Traduz exceções do PDF.js (por nome, sem importar as classes) para o erro tipado do core. */
function toSourceReadError(error: unknown): SourceReadError {
  if (error instanceof SourceReadError) return error;
  const name = (error as { name?: string } | null)?.name;
  if (name === 'PasswordException') return new SourceReadError('PASSWORD_REQUIRED', 'PDF protegido por senha', { cause: error });
  return new SourceReadError('INVALID_PDF', 'PDF inválido ou corrompido', { cause: error });
}

interface PdfMetadataInfo {
  IsAcroFormPresent?: boolean;
  IsXFAPresent?: boolean;
  IsSignaturesPresent?: boolean;
  EncryptFilterName?: string | null;
}

export function createPdfJsSourceReader(pdfjs: PdfJs, options: PdfJsOptions = {}): SourceReader {
  return {
    async read(bytes, { maxPages }) {
      try {
        return await withDocument(pdfjs, options, bytes, async (doc) => {
          // O limite é checado ANTES de percorrer as páginas: um PDF com milhões de páginas não trava a abertura.
          if (doc.numPages > maxPages) throw new SourceReadError('TOO_MANY_PAGES', `${doc.numPages} páginas`);
          const meta = (await doc.getMetadata()).info as PdfMetadataInfo;
          const pages = [];
          for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n);
            const [x0, y0, x1, y1] = page.view as View;
            pages.push({ crop: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rotation: normalizeRotation(page.rotate) });
            page.cleanup();
          }
          return {
            pages,
            encrypted: Boolean(meta.EncryptFilterName),
            acroForm: Boolean(meta.IsAcroFormPresent),
            xfa: Boolean(meta.IsXFAPresent),
            signatures: Boolean(meta.IsSignaturesPresent),
          };
        });
      } catch (error) {
        throw toSourceReadError(error);
      }
    },
  };
}

/** Inspetor usado na verificação pós-exportação. Independente do writer (pdf-lib). */
export function createPdfJsInspector(pdfjs: PdfJs, options: PdfJsOptions = {}): PdfInspector {
  return {
    inspect: (bytes) =>
      withDocument(pdfjs, options, bytes, async (doc) => {
        const pages: InspectedPage[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const [x0, y0, x1, y1] = page.view as View;
          const content = await page.getTextContent();
          const items: InspectedTextItem[] = [];
          for (const item of content.items) {
            if (!('str' in item)) continue;
            const [a = 0, b = 0, , , e = 0, f = 0] = item.transform as number[];
            items.push({ str: item.str, x: e, y: f, fontSize: Math.hypot(a, b) });
          }
          pages.push({ rotation: normalizeRotation(page.rotate), x: x0, y: y0, width: x1 - x0, height: y1 - y0, text: items.map((i) => i.str).join(' '), items });
          page.cleanup();
        }
        return { pages };
      }),
  };
}

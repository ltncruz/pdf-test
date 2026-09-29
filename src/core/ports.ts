/**
 * Portas (interfaces) que o core exige do mundo externo. Adaptadores vivem em src/pdf e src/services.
 * O core NUNCA importa PDF.js, pdf-lib, qpdf, React ou DOM.
 */
import type { SourceId } from './document/ids';
import type { Rect, Rotation } from './pages/page';
import type { ExportPlan } from './export/plan';

/** Armazena os bytes dos PDFs de origem (memória, OPFS, disco no desktop...). */
export interface SourceStore {
  has(id: SourceId): Promise<boolean>;
  /** Lança se a origem não existir. O chamador NÃO deve mutar o resultado. */
  get(id: SourceId): Promise<Uint8Array>;
  put(id: SourceId, bytes: Uint8Array): Promise<void>;
  /** Libera os bytes de uma origem (documento fechado/substituído). Não falha se não existir. */
  delete(id: SourceId): Promise<void>;
}

export interface SourcePageInfo {
  readonly crop: Rect;
  readonly rotation: Rotation;
}
export interface SourceInfo {
  readonly pages: readonly SourcePageInfo[];
  /** PDF criptografado (senha de usuário exigida OU apenas restrições de permissão). */
  readonly encrypted: boolean;
  readonly acroForm: boolean;
  readonly xfa: boolean;
  readonly signatures: boolean;
}
/**
 * Lê a estrutura básica de um PDF de origem (implementado com PDF.js).
 * Deve lançar `SourceReadError` (tipado) para senha exigida, PDF inválido e páginas demais, e DEVE checar
 * `maxPages` ANTES de percorrer as páginas.
 */
export interface SourceReader {
  read(bytes: Uint8Array, options: { readonly maxPages: number }): Promise<SourceInfo>;
}

/** Materializa um ExportPlan em bytes de PDF (implementado com pdf-lib). */
export interface PdfWriter {
  materialize(plan: ExportPlan, sources: SourceStore): Promise<Uint8Array>;
}

/** Um trecho de texto extraído, em user space PDF (independe de /Rotate). */
export interface InspectedTextItem {
  readonly str: string;
  /** Origem do texto (início da linha de base). */
  readonly x: number;
  readonly y: number;
  /** Tamanho efetivo da fonte, derivado da matriz de texto. */
  readonly fontSize: number;
}
export interface InspectedPage {
  /** /Rotate da página resultante. */
  readonly rotation: Rotation;
  /** CropBox efetiva (interseção com a MediaBox), em user space, sem rotação. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Texto extraído da página (itens separados por espaço). */
  readonly text: string;
  /** Mesmo texto, item a item, com posição e tamanho. */
  readonly items: readonly InspectedTextItem[];
}
export interface InspectedDocument {
  readonly pages: readonly InspectedPage[];
}
/** Parser INDEPENDENTE do writer, usado para verificar o PDF exportado (implementado com PDF.js). */
export interface PdfInspector {
  inspect(bytes: Uint8Array): Promise<InspectedDocument>;
}

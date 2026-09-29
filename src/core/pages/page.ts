import type { ObjectId, PageId, SourceId } from '../document/ids';

export type Rotation = 0 | 90 | 180 | 270;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Rgb {
  /** Componentes de 0 a 1. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export type PageOrigin =
  | { readonly kind: 'source'; readonly sourceId: SourceId; readonly index: number }
  | { readonly kind: 'blank' };

/**
 * Caixa de texto simples (slice v0.1-v0.5).
 * `rect` está no "espaço de página do modelo": pontos PDF, origem no canto superior
 * esquerdo da CropBox, eixo y para baixo, página SEM rotação (nem /Rotate nem a do usuário).
 * Ver ARCHITECTURE.md, seção "Contrato de coordenadas".
 */
export interface TextObject {
  readonly id: ObjectId;
  readonly kind: 'text';
  readonly rect: Rect;
  readonly text: string;
  readonly fontSize: number;
  readonly color: Rgb;
}

/** União aberta: novos tipos (imagem, ink, forma, assinatura, redação...) entram aqui nas próximas versões. */
export type PageObject = TextObject;

/** Propriedades de um objeto que podem ser alteradas por `object/update` (id e kind são imutáveis). */
export type TextObjectPatch = Partial<Pick<TextObject, 'rect' | 'text' | 'fontSize' | 'color'>>;

export interface Page {
  readonly id: PageId;
  readonly origin: PageOrigin;
  /** CropBox efetiva em user space PDF (origem inferior esquerda), em pontos, sem rotação. */
  readonly crop: Rect;
  /** /Rotate do arquivo de origem. */
  readonly baseRotation: Rotation;
  /** Rotação adicional aplicada pelo usuário (delta sobre baseRotation). */
  readonly rotation: Rotation;
  /** Ordem do array = z-order (o último fica por cima). */
  readonly objects: readonly PageObject[];
}

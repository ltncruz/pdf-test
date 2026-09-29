import type { DocumentState } from '../document/state';
import type { SourceId } from '../document/ids';
import type { Rect, Rgb, Rotation } from '../pages/page';
import { effectiveRotation, modelRectToUserSpace } from '../pages/geometry';
import { getOrderedPages } from '../document/selectors';

/** Entrelinha das caixas de texto = fontSize * fator. Vive no plano para writer e verificação usarem o mesmo valor. */
export const TEXT_LINE_HEIGHT_FACTOR = 1.2;

export interface TextOverlayPlan {
  readonly text: string;
  /** Retângulo em user space PDF (origem inferior esquerda). */
  readonly rect: Rect;
  readonly fontSize: number;
  /** Distância entre linhas de base, em pontos. */
  readonly lineHeight: number;
  readonly color: Rgb;
}

export interface PagePlan {
  /** null = página em branco. */
  readonly source: { readonly sourceId: SourceId; readonly index: number } | null;
  readonly crop: Rect;
  /** Valor final de /Rotate (base + usuário). */
  readonly rotation: Rotation;
  readonly texts: readonly TextOverlayPlan[];
}

export interface ExportPlan {
  readonly pages: readonly PagePlan[];
}

/** Função PURA: DocumentState -> plano de exportação. Nenhum I/O, nenhuma biblioteca de PDF. */
export function buildExportPlan(state: DocumentState): ExportPlan {
  return {
    pages: getOrderedPages(state).map((page) => ({
      source: page.origin.kind === 'source' ? { sourceId: page.origin.sourceId, index: page.origin.index } : null,
      crop: page.crop,
      rotation: effectiveRotation(page),
      texts: page.objects.map((o) => ({
        text: o.text,
        rect: modelRectToUserSpace(page, o.rect),
        fontSize: o.fontSize,
        lineHeight: o.fontSize * TEXT_LINE_HEIGHT_FACTOR,
        color: o.color,
      })),
    })),
  };
}

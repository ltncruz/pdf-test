import type { Page, Rect, Rotation } from './page';

export function normalizeRotation(degrees: number): Rotation {
  const r = (((degrees % 360) + 360) % 360) as number;
  if (r !== 0 && r !== 90 && r !== 180 && r !== 270) {
    throw new RangeError(`Rotação inválida: ${degrees} (use múltiplos de 90)`);
  }
  return r;
}

export function addRotation(a: Rotation, deltaDegrees: number): Rotation {
  return normalizeRotation(a + deltaDegrees);
}

/** Rotação final gravada em /Rotate na exportação e usada pelo viewer. */
export function effectiveRotation(page: Page): Rotation {
  return addRotation(page.baseRotation, page.rotation);
}

/** Tamanho como o usuário vê a página (w/h trocam em 90 e 270). */
export function displaySize(page: Page): { w: number; h: number } {
  const swap = effectiveRotation(page) % 180 !== 0;
  return swap ? { w: page.crop.h, h: page.crop.w } : { w: page.crop.w, h: page.crop.h };
}

/**
 * Converte um retângulo do espaço de página do modelo (origem topo-esquerda, y para baixo)
 * para user space PDF (origem inferior esquerda). `y` do resultado é a borda INFERIOR do retângulo.
 */
export function modelRectToUserSpace(page: Page, rect: Rect): Rect {
  return {
    x: page.crop.x + rect.x,
    y: page.crop.y + page.crop.h - rect.y - rect.h,
    w: rect.w,
    h: rect.h,
  };
}

export function isRectInsidePage(page: Page, rect: Rect): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= page.crop.w && rect.y + rect.h <= page.crop.h;
}

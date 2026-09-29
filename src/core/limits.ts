/**
 * Guardrails de recursos: TODOS os limites vivem aqui (nenhum número mágico espalhado pelo código).
 * Os valores iniciais são conservadores para o navegador; o desktop pode passar overrides via `resolveLimits`.
 */
export interface Limits {
  /** Tamanho máximo do arquivo aberto, em bytes. */
  readonly maxFileBytes: number;
  /** Máximo de páginas do PDF aberto. */
  readonly maxPages: number;
  /** Maior lado permitido da CropBox de uma página, em pontos PDF. */
  readonly maxPageDimensionPt: number;
  /** Máximo de pixels de um canvas de renderização (largura x altura do backing store). */
  readonly maxCanvasPixels: number;
  /** Renderizações simultâneas (página principal + miniaturas). */
  readonly maxConcurrentRenders: number;
  /** Faixa aceita para o fator de escala de renderização. */
  readonly minRenderScale: number;
  readonly maxRenderScale: number;
}

/**
 * Justificativa dos valores iniciais:
 * - maxFileBytes 100 MiB: no navegador o PDF existe em ~3 cópias no pico (SourceStore, cópia enviada ao worker do
 *   PDF.js, leitura do pdf-lib na exportação), então 100 MiB já significa ~300-400 MiB de memória.
 * - maxPages 2000: cobre documentos reais grandes; o custo de abrir é linear (uma leitura de cabeçalho por página).
 * - maxPageDimensionPt 14 400 (200 in): limite de tamanho de página do PDF 1.6+/Acrobat; acima disso é degenerado ou hostil.
 * - maxCanvasPixels 16 777 216 (4096x4096): limite de canvas do Safari/iOS e ~64 MiB de RGBA por canvas.
 * - maxConcurrentRenders 3: o PDF.js processa em um worker; mais concorrência só aumenta memória sem ganho.
 * - escala 0.1..8: fora disso a página fica ilegível ou o canvas é absurdo antes mesmo do limite de pixels.
 */
export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxFileBytes: 100 * 1024 * 1024,
  maxPages: 2000,
  maxPageDimensionPt: 14_400,
  maxCanvasPixels: 4096 * 4096,
  maxConcurrentRenders: 3,
  minRenderScale: 0.1,
  maxRenderScale: 8,
});

/** Aplica overrides sobre os padrões e valida (positivos, finitos; inteiros onde faz sentido). */
export function resolveLimits(overrides: Partial<Limits> = {}): Limits {
  const merged: Limits = { ...DEFAULT_LIMITS, ...overrides };
  const positive = (name: keyof Limits): void => {
    const v = merged[name];
    if (!Number.isFinite(v) || v <= 0) throw new RangeError(`Limite inválido: ${name} = ${String(v)}`);
  };
  (Object.keys(merged) as (keyof Limits)[]).forEach(positive);
  for (const name of ['maxFileBytes', 'maxPages', 'maxCanvasPixels', 'maxConcurrentRenders'] as const) {
    if (!Number.isInteger(merged[name])) throw new RangeError(`Limite inválido: ${name} deve ser inteiro`);
  }
  if (merged.minRenderScale > merged.maxRenderScale) throw new RangeError('Limite inválido: minRenderScale > maxRenderScale');
  return Object.freeze(merged);
}

/** Restringe o fator de escala à faixa permitida; recusa valores não numéricos. */
export function clampRenderScale(scale: number, limits: Limits): number {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError(`Escala de renderização inválida: ${scale}`);
  return Math.min(limits.maxRenderScale, Math.max(limits.minRenderScale, scale));
}

/**
 * Define a resolução do backing store: normalmente `dpr` (nitidez em telas HiDPI), mas reduzida quando
 * (cssW*s)*(cssH*s) passaria de maxCanvasPixels. O tamanho CSS da página não muda; só a nitidez cai.
 */
export function planCanvas(cssWidth: number, cssHeight: number, dpr: number, limits: Limits): { outputScale: number; width: number; height: number; reduced: boolean } {
  if (![cssWidth, cssHeight, dpr].every((n) => Number.isFinite(n) && n > 0)) throw new RangeError('Dimensões de canvas inválidas');
  const wanted = cssWidth * dpr * (cssHeight * dpr);
  const outputScale = wanted <= limits.maxCanvasPixels ? dpr : Math.sqrt(limits.maxCanvasPixels / (cssWidth * cssHeight));
  const width = Math.max(1, Math.floor(cssWidth * outputScale));
  const height = Math.max(1, Math.floor(cssHeight * outputScale));
  return { outputScale, width, height, reduced: outputScale < dpr };
}

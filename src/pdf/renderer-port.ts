/**
 * Porta de renderização do viewer. Arquivo SOMENTE de tipos: pode ser importado por features/*
 * sem acoplar a nenhuma biblioteca de PDF (a implementação com PDF.js vive em pdfjs-renderer.ts).
 */
import type { SourceId } from '../core/document/ids';
import type { Rotation } from '../core/pages/page';

export interface RenderRequest {
  readonly sourceId: SourceId;
  /** Índice 0-based da página no PDF de origem. */
  readonly index: number;
  /** Rotação FINAL desejada (base + usuário); substitui o /Rotate do arquivo no viewport. */
  readonly rotation: Rotation;
  /** Escala pedida; o renderizador a restringe à faixa permitida por Limits. */
  readonly scale: number;
  readonly canvas: HTMLCanvasElement;
  readonly signal?: AbortSignal;
}

export interface RenderResult {
  /** true se a resolução do canvas foi reduzida para respeitar maxCanvasPixels (a página fica menos nítida, não menor). */
  readonly reducedResolution: boolean;
}

/** Desenha só o conteúdo ORIGINAL da página; objetos adicionados vêm do modelo (overlay). */
export interface PageRenderer {
  /** Resolve `null` quando cancelado (ou substituído) antes de concluir. Lança em falhas reais de renderização. */
  render(request: RenderRequest): Promise<RenderResult | null>;
  /** Libera o documento aberto para esta origem (chamar quando a origem é descartada). */
  release(sourceId: SourceId): Promise<void>;
  dispose(): Promise<void>;
}

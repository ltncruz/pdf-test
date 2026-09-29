import type { DocumentState } from '../document/state';
import type { PageId } from '../document/ids';
import type { SourceStore } from '../ports';
import { isWinAnsiText } from './encoding';
import { isRectInsidePage } from '../pages/geometry';
import { getOrderedPages } from '../document/selectors';
import { sourceLimitations } from '../document/limitations';

export type PreflightCode =
  | 'EMPTY_DOCUMENT'
  | 'SOURCE_MISSING'
  | 'SOURCE_PAGE_OUT_OF_RANGE'
  | 'TEXT_EMPTY'
  | 'TEXT_NOT_ENCODABLE'
  | 'INVALID_FONT_SIZE'
  | 'INVALID_RECT'
  | 'OBJECT_OUTSIDE_PAGE'
  | 'FORM_NOT_PRESERVED'
  | 'SIGNATURE_NOT_PRESERVED';

export interface PreflightIssue {
  readonly severity: 'error' | 'warning';
  readonly code: PreflightCode;
  readonly message: string;
  readonly pageId?: PageId;
}

const finite = (...n: number[]): boolean => n.every((v) => Number.isFinite(v));

/** Detecta, ANTES de gerar qualquer arquivo, tudo que produziria um PDF inválido ou incorreto. */
export async function preflight(state: DocumentState, sources: SourceStore): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];
  const pages = getOrderedPages(state);
  if (pages.length === 0) {
    issues.push({ severity: 'error', code: 'EMPTY_DOCUMENT', message: 'O documento não tem páginas' });
  }
  const sourceOk = new Map<string, boolean>();
  for (const page of pages) {
    if (page.origin.kind === 'source') {
      const { sourceId, index } = page.origin;
      if (!sourceOk.has(sourceId)) {
        sourceOk.set(sourceId, Boolean(state.sources[sourceId]) && (await sources.has(sourceId)));
      }
      if (!sourceOk.get(sourceId)) {
        issues.push({ severity: 'error', code: 'SOURCE_MISSING', pageId: page.id, message: `PDF de origem indisponível (${sourceId})` });
      } else {
        const count = state.sources[sourceId]?.pageCount ?? 0;
        if (index < 0 || index >= count) {
          issues.push({ severity: 'error', code: 'SOURCE_PAGE_OUT_OF_RANGE', pageId: page.id, message: `Página de origem ${index} fora do intervalo (0..${count - 1})` });
        }
      }
    }
    for (const o of page.objects) {
      if (o.text.trim() === '') {
        issues.push({ severity: 'error', code: 'TEXT_EMPTY', pageId: page.id, message: 'Caixa de texto vazia' });
      } else if (!isWinAnsiText(o.text)) {
        issues.push({ severity: 'error', code: 'TEXT_NOT_ENCODABLE', pageId: page.id, message: 'O texto contém caracteres não suportados pela fonte padrão (WinAnsi)' });
      }
      if (!finite(o.fontSize) || o.fontSize <= 0) {
        issues.push({ severity: 'error', code: 'INVALID_FONT_SIZE', pageId: page.id, message: `Tamanho de fonte inválido: ${o.fontSize}` });
      }
      const { x, y, w, h } = o.rect;
      if (!finite(x, y, w, h) || w <= 0 || h <= 0) {
        issues.push({ severity: 'error', code: 'INVALID_RECT', pageId: page.id, message: 'Retângulo do objeto inválido' });
      } else if (!isRectInsidePage(page, o.rect)) {
        issues.push({ severity: 'warning', code: 'OBJECT_OUTSIDE_PAGE', pageId: page.id, message: 'Objeto parcialmente fora da página' });
      }
    }
  }
  for (const l of sourceLimitations(state)) issues.push({ severity: 'warning', code: l.code, message: l.message });
  return issues;
}

import type { InspectedDocument, InspectedTextItem, PdfInspector } from '../ports';
import type { SourceId } from '../document/ids';
import type { ExportPlan, TextOverlayPlan } from './plan';

/**
 * Tolerâncias da verificação (pontos PDF). Existem porque o PDF.js reporta números de ponto flutuante e porque
 * a posição vem de uma matriz de texto; são apertadas de propósito: um deslocamento de 1 pt já é detectado.
 */
export const VERIFY_TOLERANCES = { boxPt: 0.01, positionPt: 1, fontSizeRel: 0.01, fontSizeAbs: 0.05, linePitchPt: 0.5 } as const;

export type VerifyCode =
  | 'UNREADABLE_OUTPUT'
  | 'UNREADABLE_SOURCE'
  | 'PAGE_COUNT'
  | 'PAGE_ROTATION'
  | 'PAGE_SIZE'
  | 'PAGE_BOX'
  | 'PAGE_CONTENT'
  | 'TEXT_MISSING'
  | 'TEXT_WRONG_PAGE'
  | 'TEXT_POSITION'
  | 'TEXT_SIZE'
  | 'TEXT_LAYOUT'
  | 'UNEXPECTED_TEXT';

export interface VerifyIssue {
  readonly code: VerifyCode;
  readonly message: string;
  readonly pageIndex?: number;
}

/** Permite comparar cada página de origem copiada com o que o PDF exportado contém. */
export interface VerifyContext {
  inspectSource(sourceId: SourceId): Promise<InspectedDocument>;
}

const squash = (s: string): string => s.normalize('NFC').replace(/\s+/g, '');
const isNonEmpty = (i: InspectedTextItem): boolean => squash(i.str).length > 0;
const joined = (items: readonly InspectedTextItem[]): string => squash(items.map((i) => i.str).join(''));

/** Procura, a partir de `from`, uma sequência contínua de itens cujo texto (sem espaços) seja exatamente `target`. */
function findRun(items: readonly InspectedTextItem[], from: number, target: string): { start: number; end: number } | null {
  for (let start = from; start < items.length; start++) {
    let acc = '';
    for (let end = start; end < items.length; end++) {
      acc += squash(items[end]!.str);
      if (acc === target) return { start, end };
      if (!target.startsWith(acc)) break;
    }
  }
  return null;
}

function verifyTextGeometry(run: readonly InspectedTextItem[], t: TextOverlayPlan, page: number): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const tol = VERIFY_TOLERANCES;
  const first = run[0]!;
  const expectedBaseline = t.rect.y + t.rect.h - t.fontSize;
  // Texto que começa com espaço desloca o primeiro item visível: só o eixo y é confiável nesse caso.
  const checkX = !/^\s/.test(t.text);
  if ((checkX && Math.abs(first.x - t.rect.x) > tol.positionPt) || Math.abs(first.y - expectedBaseline) > tol.positionPt) {
    issues.push({ code: 'TEXT_POSITION', pageIndex: page, message: `Página ${page + 1}: texto "${clip(t.text)}" em (${fmt(first.x)}, ${fmt(first.y)}), esperado perto de (${fmt(t.rect.x)}, ${fmt(expectedBaseline)})` });
  }
  const badSize = run.find((i) => Math.abs(i.fontSize - t.fontSize) > Math.max(tol.fontSizeAbs, t.fontSize * tol.fontSizeRel));
  if (badSize) {
    issues.push({ code: 'TEXT_SIZE', pageIndex: page, message: `Página ${page + 1}: texto "${clip(t.text)}" com fonte ${fmt(badSize.fontSize)} pt, esperado ${fmt(t.fontSize)} pt` });
  }
  // Só linhas em branco explícitas no texto (\n\n...) justificam saltos maiores que 1 entrelinha; quebra por largura, não.
  const longestBreak = Math.max(0, ...(t.text.match(/\n(?:[ \t]*\n)*/g) ?? []).map((m) => m.split('\n').length - 1));
  const maxLines = Math.max(1, longestBreak);
  for (let k = 1; k < run.length; k++) {
    const prev = run[k - 1]!;
    const cur = run[k]!;
    const dy = prev.y - cur.y;
    if (Math.abs(dy) <= 0.01) continue; // mesma linha
    const lines = Math.round(dy / t.lineHeight);
    if (lines < 1 || lines > maxLines || Math.abs(dy - lines * t.lineHeight) > tol.linePitchPt || Math.abs(cur.x - t.rect.x) > tol.positionPt) {
      issues.push({ code: 'TEXT_LAYOUT', pageIndex: page, message: `Página ${page + 1}: quebra de linha de "${clip(t.text)}" fora do esperado (entrelinha ${fmt(dy)} pt, esperada ${fmt(t.lineHeight)} pt, início da linha em x=${fmt(cur.x)})` });
      break;
    }
  }
  return issues;
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();
const clip = (s: string): string => (s.length > 30 ? `${s.slice(0, 30)}…` : s);

/**
 * Reabre o PDF gerado com um parser independente do writer e confere as INVARIANTES SUPORTADAS pelo plano:
 * número de páginas; rotação, tamanho e origem da CropBox de cada página; identidade do conteúdo de cada página de
 * origem (texto extraído igual ao da origem); e, para cada caixa de texto adicionada, presença na página certa, na ordem
 * certa, posição, tamanho da fonte e quebras de linha. Não verifica: cor, opacidade, aparência visual (raster),
 * imagens/vetores da origem, anotações, formulários nem metadados.
 * Sem `context`, a identidade do conteúdo de origem e o texto inesperado NÃO são verificados.
 */
export async function verifyExport(bytes: Uint8Array, plan: ExportPlan, inspector: PdfInspector, context?: VerifyContext): Promise<VerifyIssue[]> {
  let doc: InspectedDocument;
  try {
    doc = await inspector.inspect(bytes);
  } catch (cause) {
    return [{ code: 'UNREADABLE_OUTPUT', message: `O PDF gerado não pôde ser reaberto: ${cause instanceof Error ? cause.message : String(cause)}` }];
  }
  if (doc.pages.length !== plan.pages.length) {
    return [{ code: 'PAGE_COUNT', message: `Esperava ${plan.pages.length} páginas, o PDF tem ${doc.pages.length}` }];
  }

  const issues: VerifyIssue[] = [];
  const sourceCache = new Map<SourceId, InspectedDocument | null>();
  const getSource = async (id: SourceId): Promise<InspectedDocument | null> => {
    if (!context) return null;
    if (!sourceCache.has(id)) {
      try {
        sourceCache.set(id, await context.inspectSource(id));
      } catch (cause) {
        sourceCache.set(id, null);
        issues.push({ code: 'UNREADABLE_SOURCE', message: `PDF de origem não pôde ser lido para comparação: ${cause instanceof Error ? cause.message : String(cause)}` });
      }
    }
    return sourceCache.get(id) ?? null;
  };

  for (const [i, expected] of plan.pages.entries()) {
    const actual = doc.pages[i]!;
    const tol = VERIFY_TOLERANCES;
    if (actual.rotation !== expected.rotation) {
      issues.push({ code: 'PAGE_ROTATION', pageIndex: i, message: `Página ${i + 1}: rotação ${actual.rotation}, esperada ${expected.rotation}` });
    }
    if (Math.abs(actual.width - expected.crop.w) > tol.boxPt || Math.abs(actual.height - expected.crop.h) > tol.boxPt) {
      issues.push({ code: 'PAGE_SIZE', pageIndex: i, message: `Página ${i + 1}: tamanho ${fmt(actual.width)}x${fmt(actual.height)}, esperado ${fmt(expected.crop.w)}x${fmt(expected.crop.h)}` });
    }
    if (Math.abs(actual.x - expected.crop.x) > tol.boxPt || Math.abs(actual.y - expected.crop.y) > tol.boxPt) {
      issues.push({ code: 'PAGE_BOX', pageIndex: i, message: `Página ${i + 1}: origem da CropBox (${fmt(actual.x)}, ${fmt(actual.y)}), esperada (${fmt(expected.crop.x)}, ${fmt(expected.crop.y)})` });
    }

    const items = actual.items.filter(isNonEmpty);
    // Quantos itens iniciais pertencem ao conteúdo ORIGINAL da página (os overlays são acrescentados depois dele).
    let baseline: number | null = expected.source === null ? 0 : null;
    if (expected.source !== null) {
      const src = await getSource(expected.source.sourceId);
      const srcPage = src?.pages[expected.source.index];
      if (src && !srcPage) {
        issues.push({ code: 'PAGE_CONTENT', pageIndex: i, message: `Página ${i + 1}: a origem não tem a página ${expected.source.index + 1}` });
      } else if (srcPage) {
        const srcItems = srcPage.items.filter(isNonEmpty);
        if (items.length < srcItems.length || joined(items.slice(0, srcItems.length)) !== joined(srcItems)) {
          issues.push({ code: 'PAGE_CONTENT', pageIndex: i, message: `Página ${i + 1}: o conteúdo de texto não corresponde à página ${expected.source.index + 1} do PDF de origem (página trocada ou conteúdo alterado)` });
        } else {
          baseline = srcItems.length;
        }
      }
    }

    let cursor = baseline ?? 0;
    for (const t of expected.texts) {
      const target = squash(t.text);
      const run = findRun(items, cursor, target);
      if (!run) {
        const other = doc.pages.findIndex((p, j) => j !== i && squash(p.text).includes(target));
        issues.push(
          other >= 0
            ? { code: 'TEXT_WRONG_PAGE', pageIndex: i, message: `Página ${i + 1}: o texto "${clip(t.text)}" não está aqui, mas aparece na página ${other + 1}` }
            : { code: 'TEXT_MISSING', pageIndex: i, message: `Página ${i + 1}: texto adicionado "${clip(t.text)}" não encontrado no PDF exportado` },
        );
        continue;
      }
      if (baseline !== null && run.start !== cursor) {
        issues.push({ code: 'UNEXPECTED_TEXT', pageIndex: i, message: `Página ${i + 1}: há texto inesperado antes de "${clip(t.text)}"` });
      }
      issues.push(...verifyTextGeometry(items.slice(run.start, run.end + 1), t, i));
      cursor = run.end + 1;
    }
    if (baseline !== null && cursor < items.length) {
      issues.push({ code: 'UNEXPECTED_TEXT', pageIndex: i, message: `Página ${i + 1}: texto inesperado no final da página ("${clip(items.slice(cursor).map((x) => x.str).join(' '))}")` });
    }
  }
  return issues;
}

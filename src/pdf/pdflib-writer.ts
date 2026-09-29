import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFRef, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { SourceId } from '../core/document/ids';
import type { PdfWriter } from '../core/ports';
import type { PagePlan, TextOverlayPlan } from '../core/export/plan';

function drawTextBox(page: PDFPage, font: PDFFont, t: TextOverlayPlan): void {
  // Primeira linha: topo do retângulo menos o tamanho da fonte. Quebra por largura via maxWidth.
  page.drawText(t.text, {
    x: t.rect.x,
    y: t.rect.y + t.rect.h - t.fontSize,
    size: t.fontSize,
    lineHeight: t.lineHeight,
    maxWidth: t.rect.w,
    font,
    color: rgb(t.color.r, t.color.g, t.color.b),
  });
}

/** Array de destino de um link interno: /Dest [...] ou /A << /S /GoTo /D [...] >>. Nomes/strings (destinos nomeados) retornam null. */
function destArrayOf(annot: PDFDict): PDFArray | null {
  const dest = annot.lookup(PDFName.of('Dest'));
  if (dest instanceof PDFArray) return dest;
  const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
  if (action && action.lookup(PDFName.of('S')) === PDFName.of('GoTo')) {
    const d = action.lookup(PDFName.of('D'));
    if (d instanceof PDFArray) return d;
  }
  return null;
}

interface LinkFixup {
  readonly pageIndex: number;
  readonly annotIndex: number;
  readonly targetIndex: number;
}

/**
 * Links internos entre páginas. O copiador do pdf-lib, ao encontrar /Dest [ref ...], copia o OBJETO da página de destino
 * como uma duplicata solta (fora da árvore de páginas): o link fica quebrado e, se o destino foi excluído, o conteúdo
 * da página excluída continua dentro do arquivo. Por isso, ANTES de copiar (só na cópia em memória da origem):
 *  - link cujo destino não será exportado: a anotação é removida;
 *  - link cujo destino será exportado: a referência de página é trocada por null e um "fixup" é devolvido; depois da
 *    cópia, o writer aponta o link para a página copiada de verdade.
 * Os bytes originais nunca são alterados.
 */
function prepareInternalLinks(src: PDFDocument, indices: readonly number[], allUsed: ReadonlySet<number>): LinkFixup[] {
  const pages = src.getPages();
  const indexOfRef = new Map(pages.map((p, i) => [p.ref.tag, i]));
  const targetOf = (annot: PDFDict): number | null => {
    const first = destArrayOf(annot)?.get(0);
    return first instanceof PDFRef ? (indexOfRef.get(first.tag) ?? -1) : null;
  };
  const fixups: LinkFixup[] = [];
  for (const pageIndex of indices) {
    const annots = pages[pageIndex]?.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let j = annots.size() - 1; j >= 0; j--) {
      const annot = annots.lookupMaybe(j, PDFDict);
      const target = annot ? targetOf(annot) : null;
      if (target !== null && !allUsed.has(target)) annots.remove(j); // destino excluído (ou fora do documento)
    }
    for (let j = 0; j < annots.size(); j++) {
      const annot = annots.lookupMaybe(j, PDFDict);
      const target = annot ? targetOf(annot) : null;
      if (annot && target !== null) {
        destArrayOf(annot)!.set(0, PDFNull);
        fixups.push({ pageIndex, annotIndex: j, targetIndex: target });
      }
    }
  }
  return fixups;
}

function applyLinkFixups(fixups: readonly LinkFixup[], copiedPage: (index: number) => PDFPage | undefined, targetPage: (index: number) => PDFPage | undefined): void {
  for (const f of fixups) {
    const annot = copiedPage(f.pageIndex)?.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.lookupMaybe(f.annotIndex, PDFDict);
    const target = targetPage(f.targetIndex);
    const arr = annot ? destArrayOf(annot) : null;
    if (arr && target) arr.set(0, target.ref);
  }
}

/**
 * Adaptador pdf-lib. Cria SEMPRE um novo documento (o original nunca é alterado, nem reescrito
 * incrementalmente) e copia as páginas de cada origem numa ÚNICA chamada a copyPages por "rodada":
 * assim recursos compartilhados são copiados uma vez e links internos entre páginas mantidas apontam
 * para as páginas copiadas (não para duplicatas). Uma página de origem usada mais de uma vez entra em rodadas
 * diferentes (cópias independentes, para poder ter rotação e overlays próprios).
 */
export function createPdfLibWriter(): PdfWriter {
  return {
    async materialize(plan, sources) {
      const out = await PDFDocument.create();
      out.setProducer('Simply PDF');
      out.setCreator('Simply PDF');
      const font = await out.embedFont(StandardFonts.Helvetica);

      // 1) Agrupa as páginas de cada origem em rodadas: rodada k = k-ésima ocorrência de cada índice.
      const occurrences = new Map<string, number>();
      const rounds = new Map<SourceId, Map<number, number[]>>();
      const keyOf = (sourceId: SourceId, index: number, round: number): string => `${sourceId}:${index}:${round}`;
      const roundOfPage: number[] = plan.pages.map((p) => {
        if (!p.source) return 0;
        const k = `${p.source.sourceId}:${p.source.index}`;
        const round = occurrences.get(k) ?? 0;
        occurrences.set(k, round + 1);
        let bySource = rounds.get(p.source.sourceId);
        if (!bySource) rounds.set(p.source.sourceId, (bySource = new Map()));
        const list = bySource.get(round) ?? [];
        if (!list.includes(p.source.index)) list.push(p.source.index);
        bySource.set(round, list);
        return round;
      });

      // 2) Copia cada rodada de cada origem de uma vez só. A rodada 0 contém TODOS os índices usados da origem,
      //    então os links de qualquer rodada podem apontar para as cópias da rodada 0.
      const copied = new Map<string, PDFPage>();
      for (const [sourceId, byRound] of rounds) {
        const bytes = await sources.get(sourceId);
        const allUsed = new Set([...byRound.values()].flat());
        for (const [round, indices] of [...byRound].sort((a, b) => a[0] - b[0])) {
          const src = await PDFDocument.load(bytes); // leitura nova por rodada: a preparação abaixo altera só esta cópia
          const fixups = prepareInternalLinks(src, indices, allUsed);
          const pages = await out.copyPages(src, indices);
          indices.forEach((index, n) => {
            const page = pages[n];
            if (!page) throw new Error(`Página ${index} não pôde ser copiada`);
            copied.set(keyOf(sourceId, index, round), page);
          });
          applyLinkFixups(fixups, (i) => copied.get(keyOf(sourceId, i, round)), (i) => copied.get(keyOf(sourceId, i, 0)));
        }
      }

      // 3) Monta o documento na ordem do plano.
      plan.pages.forEach((p, i) => {
        let page: PDFPage;
        if (!p.source) {
          page = out.addPage([p.crop.w, p.crop.h]);
          page.setMediaBox(p.crop.x, p.crop.y, p.crop.w, p.crop.h);
        } else {
          const original = copied.get(keyOf(p.source.sourceId, p.source.index, roundOfPage[i] ?? 0));
          if (!original) throw new Error(`Página ${p.source.index} não foi copiada`);
          page = out.addPage(original);
          page.setCropBox(p.crop.x, p.crop.y, p.crop.w, p.crop.h);
        }
        page.setRotation(degrees(p.rotation));
        for (const t of p.texts) drawTextBox(page, font, t);
      });
      return out.save();
    },
  };
}

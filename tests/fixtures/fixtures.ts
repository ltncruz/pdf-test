import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

export const MARKERS = ['PAGE-1-ALPHA', 'PAGE-2-BRAVO', 'PAGE-3-CHARLIE'] as const;

/**
 * PDF de teste com 3 páginas DISTINTAS (para detectar qualquer troca de ordem/identidade):
 *  1. Carta 612x792, sem rotação.
 *  2. A4 595x842 com /Rotate 90 no arquivo de origem.
 *  3. MediaBox 400x500 com CropBox deslocada (20,30) de 300x400 (testa origem não zero).
 * Cada página tem um marcador de texto único e um retângulo preto (para checar renderização não branca).
 */
export async function buildSamplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const mark = (page: ReturnType<PDFDocument['addPage']>, text: string, x: number, y: number): void => {
    page.drawRectangle({ x, y: y - 40, width: 120, height: 30, color: rgb(0, 0, 0) });
    page.drawText(text, { x, y, size: 20, font, color: rgb(0, 0, 0) });
  };
  const p1 = pdf.addPage([612, 792]);
  mark(p1, MARKERS[0], 72, 700);
  const p2 = pdf.addPage([595, 842]);
  mark(p2, MARKERS[1], 72, 760);
  p2.setRotation(degrees(90));
  const p3 = pdf.addPage([400, 500]);
  p3.setCropBox(20, 30, 300, 400);
  mark(p3, MARKERS[2], 60, 400);
  return pdf.save();
}

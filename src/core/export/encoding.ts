/**
 * O slice desenha texto com a fonte padrão Helvetica (WinAnsi / cp1252), sem embutir fonte.
 * Este conjunto DEVE coincidir com o que o writer consegue codificar (há teste de consistência
 * contra o pdf-lib em tests/integration). Fontes embutidas (Unicode) ficam para v0.7.
 */
const CP1252_EXTRAS = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function isWinAnsiChar(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRAS.has(cp);
}

/** True se todo o texto (linhas separadas por \n) é codificável em WinAnsi. */
export function isWinAnsiText(text: string): boolean {
  for (const ch of text.replace(/\n/g, '')) if (!isWinAnsiChar(ch)) return false;
  return true;
}

export const WIN_ANSI_EXTRAS: readonly number[] = [...CP1252_EXTRAS];

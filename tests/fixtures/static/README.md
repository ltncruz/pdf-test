# Fixtures estáticas (binárias, pequenas)

Geradas UMA vez e versionadas; os testes conferem o SHA-256 em `MANIFEST.json` para detectar alteração acidental.
Todas as demais fixtures do corpus são geradas por código em `../corpus.ts` a cada execução.

| Arquivo | Como foi gerado |
|---|---|
| `embedded-font.pdf` | reportlab 4.4 (`rl_config.invariant = 1`), fonte TrueType Liberation Sans Regular (SIL OFL 1.1, do pdfjs-dist/standard_fonts) incorporada como subconjunto; 2 páginas; texto com acentos |
| `encrypted-user-password.pdf` | `qpdf --encrypt userpw ownerpw 256 -- base.pdf` (AES-256): exige a senha `userpw` para abrir |
| `encrypted-owner-only.pdf` | `qpdf --encrypt "" ownerpw 256 --print=none --modify=none -- base.pdf`: abre sem senha, mas com restrições de permissão (criptografado) |

`base.pdf` = 1 página Carta com o texto `CRIPTOGRAFADO-SEGREDO` em Helvetica (reportlab, sem compressão).

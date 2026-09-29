# Simply PDF

Editor de PDF universal, local-first. Este repositório contém a **fundação v0.1–v0.5 estabilizada**: abrir → renderizar → DocumentState → excluir/girar páginas, adicionar/editar/remover caixas de texto → undo/redo → exportar → reabrir e validar as invariantes suportadas.

Leia `ARCHITECTURE.md` (arquitetura e decisões) e `THIRD_PARTY_LICENSES.md` (licenças verificadas).

## Comandos

```bash
npm run verify        # fronteiras + licenças + typecheck + testes + E2E
npm test              # core + integração (node:test via tsx)
npm run test:e2e      # build web + E2E no Chromium (Playwright)
npm run build:web     # gera dist/ (esbuild)
npm run licenses      # regenera THIRD_PARTY_LICENSES.md a partir dos pacotes instalados
npm run fixtures      # escreve tests/fixtures/out/sample-3pages.pdf
```

Para abrir o app: `npm run build:web` e sirva `dist/` com qualquer servidor estático (ES modules exigem http, não file://).

## Instalação reprodutível — ATENÇÃO (pendente)

Este snapshot **ainda não tem `package-lock.json`**: o registro npm estava bloqueado no ambiente em que foi construído (HTTP 403), e sem ele não há como obter os hashes de integridade. O `node_modules` do snapshot foi montado com links para pacotes já instalados globalmente e **não** é uma instalação limpa. Numa máquina com acesso ao registro:

```bash
npm install --package-lock-only        # gera package-lock.json com as versões fixas de package.json
npm install --save-dev --save-exact @types/react@^19 @types/react-dom@^19   # tipos oficiais
rm src/types/react-shim.d.ts           # e corrija os erros de tipo reais que aparecerem
npm ci && npm run verify               # instalação limpa + validação completa
git add package-lock.json              # versione o lockfile
```

O `verify` inclui a auditoria de licenças: as novas dependências entram em `THIRD_PARTY_LICENSES.md` apenas se estiverem dentro da política permissiva.

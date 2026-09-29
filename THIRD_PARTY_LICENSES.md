# THIRD_PARTY_LICENSES

Gerado por `node scripts/licenses.mjs` (não edite à mão; `npm run licenses -- --check` falha se estiver desatualizado).

**Método:** para cada pacote realmente instalado em `node_modules` (fechamento transitivo de `dependencies`, `devDependencies` e `optionalDependencies`), o script lê o `package.json` e **todos** os arquivos de licença do pacote (`LICENSE*`, `LICENCE*`, `COPYING*`, `UNLICENSE*`). Procura por GPL, AGPL, LGPL, SSPL, Commons Clause e Business Source License no **conteúdo completo** de cada arquivo e recusa qualquer licença declarada fora da política permissiva: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, BlueOak-1.0.0, OFL-1.1. Também registra arquivos `NOTICE`. Não se usou conhecimento prévio sobre licenças.

## Dependências de runtime (distribuídas com o produto)

| Pacote | Versão instalada | Licença (package.json) | Arquivos de licença lidos | NOTICE | Requerido por |
|---|---|---|---|---|---|
| @napi-rs/canvas | 0.1.100 | MIT | LICENSE (sha256 8802fecf9da4) | — | pdfjs-dist@5.6.205 |
| @napi-rs/canvas-linux-x64-gnu | 0.1.100 | MIT | LICENSE (herdado de @napi-rs/canvas@0.1.100) (sha256 8802fecf9da4) | — | @napi-rs/canvas@0.1.100 |
| @napi-rs/canvas-linux-x64-musl | 0.1.100 | MIT | LICENSE (herdado de @napi-rs/canvas@0.1.100) (sha256 8802fecf9da4) | — | @napi-rs/canvas@0.1.100 |
| @pdf-lib/standard-fonts | 1.0.0 | MIT | LICENSE.md (sha256 45cc2bb9957e) | — | pdf-lib@1.17.1 |
| @pdf-lib/upng | 1.0.1 | MIT | LICENSE (sha256 c1fb8861eca2) | — | pdf-lib@1.17.1 |
| node-readable-to-web-readable-stream | 0.4.2 | MIT | LICENSE.txt (sha256 d1b111f5a5b6) | — | pdfjs-dist@5.6.205 |
| pako | 1.0.11 | (MIT AND Zlib) | LICENSE (sha256 a04665b3b2de) | — | @pdf-lib/standard-fonts@1.0.0 |
| pdf-lib | 1.17.1 | MIT | LICENSE.md (sha256 f2c9fc00fdb6) | — | (projeto) |
| pdfjs-dist | 5.6.205 | Apache-2.0 | LICENSE (sha256 0d542e0c8804) | — | (projeto) |
| react | 19.2.5 | MIT | LICENSE (sha256 da6d3703ed11) | — | (projeto) |
| react-dom | 19.2.5 | MIT | LICENSE (sha256 da6d3703ed11) | — | (projeto) |
| scheduler | 0.27.0 | MIT | LICENSE (sha256 da6d3703ed11) | — | react-dom@19.2.5 |
| tslib | 1.14.1 | 0BSD | LICENSE.txt (sha256 210b19e54313) | — | pdf-lib@1.17.1 |

## Dependências de desenvolvimento (não distribuídas)

| Pacote | Versão instalada | Licença (package.json) | Arquivos de licença lidos | NOTICE | Requerido por |
|---|---|---|---|---|---|
| @esbuild/linux-x64 | 0.27.7 | MIT | LICENSE.md (herdado de esbuild@0.27.7) (sha256 b40ec5baec7b) | — | esbuild@0.27.7 |
| @types/node | 25.6.0 | MIT | LICENSE (sha256 c2cfccb812fe) | — | (projeto) |
| esbuild | 0.27.7 | MIT | LICENSE.md (sha256 b40ec5baec7b) | — | (projeto) |
| get-tsconfig | 4.14.3 | MIT | LICENSE (sha256 10c904a49af4) | — | tsx@4.21.0 |
| playwright | 1.56.0 | Apache-2.0 | LICENSE (sha256 45873d00a0dd) | NOTICE (sha256 6d602191187b); ThirdPartyNotices.txt (sha256 2eba4794fdff) | (projeto) |
| playwright-core | 1.56.0 | Apache-2.0 | LICENSE (sha256 45873d00a0dd) | NOTICE (sha256 6d602191187b); ThirdPartyNotices.txt (sha256 450299275b0e) | playwright@1.56.0 |
| resolve-pkg-maps | 1.0.0 | MIT | LICENSE (sha256 10c904a49af4) | — | get-tsconfig@4.14.3 |
| tsx | 4.21.0 | MIT | LICENSE (sha256 8dded67841a9) | — | (projeto) |
| typescript | 6.0.3 | Apache-2.0 | LICENSE.txt (sha256 a7d00bfd5452) | ThirdPartyNoticeText.txt (sha256 1af3c68039c5) | (projeto) |
| undici-types | 7.19.2 | MIT | LICENSE (sha256 a6db8096b270) | — | @types/node@25.6.0 |

## Avisos (NOTICE) a preservar

Arquivos `NOTICE`/equivalentes são **registrados**, não tratados como erro. Em pacotes Apache-2.0 distribuídos, o NOTICE deve acompanhar a redistribuição.

### Dependências de runtime (distribuídas)

Nenhuma dependência de runtime instalada traz arquivo NOTICE.

### Dependências de desenvolvimento (não distribuídas)

- playwright@1.56.0: NOTICE (sha256 6d602191187b); ThirdPartyNotices.txt (sha256 2eba4794fdff)
- playwright-core@1.56.0: NOTICE (sha256 6d602191187b); ThirdPartyNotices.txt (sha256 450299275b0e)
- typescript@6.0.3: ThirdPartyNoticeText.txt (sha256 1af3c68039c5)

### Avisos para revisão manual

Nenhum NOTICE menciona termos de licença restritiva.

## Assets distribuídos dentro do pacote web (`dist/standard_fonts`, vindos de pdfjs-dist)

| Asset | Licença lida do arquivo | Observação |
|---|---|---|
| Fontes Foxit (`FoxitFixed*.pfb`, `FoxitSans*.pfb`, `FoxitSerif*.pfb`, `FoxitSymbol.pfb`, `FoxitDingbats.pfb`) | BSD-3-Clause (cabeçalho "PDFium Authors" em `LICENSE_FOXIT`) | manter o aviso de copyright ao redistribuir |
| Fontes Liberation (`LiberationSans-*.ttf`) | SIL Open Font License 1.1 (`LICENSE_LIBERATION`) | OFL permite redistribuição junto com software; não vender a fonte isoladamente |

Esses assets são usados só pelo viewer para desenhar fontes padrão NÃO incorporadas. O PDF exportado referencia a Helvetica padrão por nome e **não incorpora** nenhuma fonte.

## Ferramentas externas (não instaladas via npm e não distribuídas)

| Ferramenta | Versão / licença | Uso |
|---|---|---|
| qpdf | não encontrado no ambiente | apenas nos testes, como validador estrutural independente (`qpdf --check`). Não faz parte do produto neste slice. |

## Dependências opcionais não instaladas neste ambiente

- `@esbuild/aix-ppc64` (opcional de `esbuild@0.27.7`)
- `@esbuild/android-arm` (opcional de `esbuild@0.27.7`)
- `@esbuild/android-arm64` (opcional de `esbuild@0.27.7`)
- `@esbuild/android-x64` (opcional de `esbuild@0.27.7`)
- `@esbuild/darwin-arm64` (opcional de `esbuild@0.27.7`)
- `@esbuild/darwin-x64` (opcional de `esbuild@0.27.7`)
- `@esbuild/freebsd-arm64` (opcional de `esbuild@0.27.7`)
- `@esbuild/freebsd-x64` (opcional de `esbuild@0.27.7`)
- `@esbuild/linux-arm` (opcional de `esbuild@0.27.7`)
- `@esbuild/linux-arm64` (opcional de `esbuild@0.27.7`)
- `@esbuild/linux-ia32` (opcional de `esbuild@0.27.7`)
- `@esbuild/linux-loong64` (opcional de `esbuild@0.27.7`)
- `@esbuild/linux-mips64el` (opcional de `esbuild@0.27.7`)
- `@esbuild/linux-ppc64` (opcional de `esbuild@0.27.7`)
- `@esbuild/linux-riscv64` (opcional de `esbuild@0.27.7`)
- `@esbuild/linux-s390x` (opcional de `esbuild@0.27.7`)
- `@esbuild/netbsd-arm64` (opcional de `esbuild@0.27.7`)
- `@esbuild/netbsd-x64` (opcional de `esbuild@0.27.7`)
- `@esbuild/openbsd-arm64` (opcional de `esbuild@0.27.7`)
- `@esbuild/openbsd-x64` (opcional de `esbuild@0.27.7`)
- `@esbuild/openharmony-arm64` (opcional de `esbuild@0.27.7`)
- `@esbuild/sunos-x64` (opcional de `esbuild@0.27.7`)
- `@esbuild/win32-arm64` (opcional de `esbuild@0.27.7`)
- `@esbuild/win32-ia32` (opcional de `esbuild@0.27.7`)
- `@esbuild/win32-x64` (opcional de `esbuild@0.27.7`)
- `@napi-rs/canvas-android-arm64` (opcional de `@napi-rs/canvas@0.1.100`)
- `@napi-rs/canvas-darwin-arm64` (opcional de `@napi-rs/canvas@0.1.100`)
- `@napi-rs/canvas-darwin-x64` (opcional de `@napi-rs/canvas@0.1.100`)
- `@napi-rs/canvas-linux-arm-gnueabihf` (opcional de `@napi-rs/canvas@0.1.100`)
- `@napi-rs/canvas-linux-arm64-gnu` (opcional de `@napi-rs/canvas@0.1.100`)
- `@napi-rs/canvas-linux-arm64-musl` (opcional de `@napi-rs/canvas@0.1.100`)
- `@napi-rs/canvas-linux-riscv64-gnu` (opcional de `@napi-rs/canvas@0.1.100`)
- `@napi-rs/canvas-win32-arm64-msvc` (opcional de `@napi-rs/canvas@0.1.100`)
- `@napi-rs/canvas-win32-x64-msvc` (opcional de `@napi-rs/canvas@0.1.100`)
- `fsevents` (opcional de `playwright@1.56.0`)
- `fsevents` (opcional de `tsx@4.21.0`)

## Candidatas NÃO adicionadas (licença ainda por verificar)

O registro npm estava bloqueado neste ambiente (HTTP 403, `x-deny-reason: host_not_allowed`), então os pacotes abaixo **não foram instalados** e portanto **não constam em `package.json`**. Cada um só entra depois de instalado e com a licença lida do pacote real:

| Candidata | Papel | Situação |
|---|---|---|
| @types/react, @types/react-dom | tipos oficiais do React | **pendente e solicitado**: substituem o shim temporário `src/types/react-shim.d.ts` |
| vite, @vitejs/plugin-react, vitest, zustand | — | **não serão adicionados** (esbuild, `node:test`, tsx e `useSyncExternalStore` continuam adequados) |
| qpdf (WASM/binário empacotado) | otimização/criptografia (v0.9) | pendente; só o binário do sistema foi usado em testes |
| PDFium (WASM) | spike futuro pedido | pendente |
| tesseract.js, fontkit, dnd-kit, @tanstack/react-virtual, fast-check | versões futuras | pendente |
| MuPDF, Ghostscript | — | **excluídos por decisão**: AGPL/comercial |

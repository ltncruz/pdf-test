import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSamplePdf } from './fixtures';

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/sample-3pages.pdf', import.meta.url), await buildSamplePdf());
console.log('Fixture escrita em tests/fixtures/out/sample-3pages.pdf');

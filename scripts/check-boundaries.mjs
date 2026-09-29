import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBoundaries } from './boundaries-lib.mjs';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const violations = checkBoundaries(src);
if (violations.length) {
  console.error('Violações de fronteira entre camadas:\n- ' + violations.join('\n- '));
  process.exit(1);
}
console.log('Fronteiras entre camadas OK.');

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

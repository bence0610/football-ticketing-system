import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Guard: the "article in parentheses" placeholder must never reach a user.
 * Hungarian has two definite articles; code that puts one in front of a
 * data-driven name has to pick it (see hungarian-article.ts) instead of
 * hedging with a placeholder. Scans the backend and frontend sources and the
 * e-mail templates.
 */
const PLACEHOLDER = new RegExp('\\b[aA]' + '\\(z\\)');

const ROOTS = [resolve(__dirname, '..'), resolve(__dirname, '../../../frontend/src')];
const EXTENSIONS = ['.ts', '.html', '.hbs', '.scss'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') {
        walk(full, out);
      }
    } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe('no article placeholder in user-facing text', () => {
  it('finds none in the backend, the frontend or the e-mail templates', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (file === __filename) {
          continue;
        }
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (PLACEHOLDER.test(line)) {
            offenders.push(`${file}:${i + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

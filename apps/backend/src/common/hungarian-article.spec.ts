import { capitalArticle, hungarianArticle } from './hungarian-article';

describe('hungarianArticle (backend copy; keep in sync with the frontend one)', () => {
  it('reads a single-letter sector code by the letter name', () => {
    for (const code of ['A', 'E', 'F', 'L', 'M', 'N', 'A/1']) {
      expect(hungarianArticle(code)).toBe('az');
      expect(hungarianArticle(`${code} szektor`)).toBe('az');
    }
    for (const code of ['B', 'C', 'D', 'G', 'H', 'J', 'K', 'B/2', 'C/1', 'D/2']) {
      expect(hungarianArticle(code)).toBe('a');
      expect(hungarianArticle(`${code} szektor`)).toBe('a');
    }
  });

  it('still handles words, acronyms and numbers', () => {
    expect(hungarianArticle('VENDÉG')).toBe('a');
    expect(hungarianArticle('VIP')).toBe('a');
    expect(hungarianArticle('KTE Legenda')).toBe('a');
    expect(hungarianArticle('Arany')).toBe('az');
    expect(hungarianArticle('1. forduló')).toBe('az');
  });

  it('capitalises for a sentence start', () => {
    expect(capitalArticle('F szektor')).toBe('Az');
    expect(capitalArticle('D/1 szektor')).toBe('A');
  });
});

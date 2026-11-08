import { hungarianArticle, withArticle } from './hungarian-article';

describe('hungarianArticle', () => {
  it('uses the right article for every loyalty tier name', () => {
    expect(withArticle('Kék')).toBe('a Kék');
    expect(withArticle('Ezüst')).toBe('az Ezüst');
    expect(withArticle('Arany')).toBe('az Arany');
    expect(withArticle('KTE Legenda')).toBe('a KTE Legenda');
  });

  it('uses "az" before vowels, including accented and double-accented ones', () => {
    ['Újpest FC', 'Őrmező', 'Ünnep', 'Ólom', 'Érd', 'Íjász'].forEach((name) => {
      expect(hungarianArticle(name)).toBe('az');
    });
  });

  it('uses "a" before consonants', () => {
    ['Kecskeméti TE', 'Paksi FC', 'Debrecen', 'Zalaegerszeg'].forEach((name) => {
      expect(hungarianArticle(name)).toBe('a');
    });
  });

  it('reads acronyms by the name of their first letter', () => {
    expect(hungarianArticle('MTK Budapest')).toBe('az'); // "em-té-ká"
    expect(hungarianArticle('NB I')).toBe('az'); // "en-bé"
    expect(hungarianArticle('FTC')).toBe('az'); // "ef-té-cé"
    expect(hungarianArticle('KTE')).toBe('a'); // "ká-té-é"
  });

  it('ignores leading punctuation and handles empty input', () => {
    expect(hungarianArticle('"Arany"')).toBe('az');
    expect(hungarianArticle('')).toBe('a');
  });
});

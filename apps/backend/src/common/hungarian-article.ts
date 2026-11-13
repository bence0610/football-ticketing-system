/**
 * Picks the Hungarian definite article for a name: "a" before a consonant
 * sound, "az" before a vowel sound. Used by the e-mail templates (Handlebars
 * helpers `article` / `Article`) so a sentence like "<article> <match title>
 * mérkőzésre" never has to print a placeholder.
 *
 * Mirrors apps/frontend/src/app/shared/utils/hungarian-article.ts — keep the
 * two in sync.
 */
const VOWEL_START = /^[aáeéiíoóöőuúüű]/i;
const VOWEL_SOUNDING_LETTERS = 'AÁEÉIÍOÓÖŐUÚÜŰFLMNRSXY';

/** A sector-style code: one capital letter, optionally with a slash or dash and a number ("F", "A/1", "D-2"). */
const LETTER_CODE = /^\p{Lu}(?:[/-]\d+)?$/u;

export type HungarianArticle = 'a' | 'az';

export function hungarianArticle(name: string): HungarianArticle {
  const word = name.trim().replace(/^[^\p{L}\p{N}]+/u, '');
  if (word === '') {
    return 'a';
  }
  if (/^\d/.test(word)) {
    return /^[15](?!\d)/.test(word) ? 'az' : 'a';
  }
  const first = word.split(/\s+/, 1)[0];
  // A single letter is read by its NAME, not as a word: "az F szektor", "az L", "az A/1",
  // but "a D/1", "a K". (E, F, L, M, N and A take "az"; the vowel-letter rule alone
  // would get F, L, M and N wrong.)
  if (LETTER_CODE.test(first)) {
    return VOWEL_SOUNDING_LETTERS.includes(first[0]) ? 'az' : 'a';
  }
  if (first.length >= 2 && first === first.toUpperCase() && /^\p{Lu}+$/u.test(first)) {
    return VOWEL_SOUNDING_LETTERS.includes(first[0]) ? 'az' : 'a';
  }
  return VOWEL_START.test(word) ? 'az' : 'a';
}

/** Sentence-initial form: "A" / "Az". */
export function capitalArticle(name: string): string {
  const article = hungarianArticle(name);
  return article === 'a' ? 'A' : 'Az';
}

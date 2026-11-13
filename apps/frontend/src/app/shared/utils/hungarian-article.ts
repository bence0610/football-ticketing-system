/**
 * Picks the Hungarian definite article for a name: "a" before a consonant
 * sound, "az" before a vowel sound. Used wherever a UI sentence puts an
 * article in front of a data-driven name (tier, team, match title), so the
 * text never has to hedge with a placeholder.
 *
 * Rules, in order:
 *  - leading punctuation / quotes are ignored;
 *  - a leading number is read by its first digit's name (1 "egy" and 5 "öt"
 *    take "az"; the rest take "a" — numbers such as 10 or 1000 are not
 *    handled, they do not occur in names here);
 *  - a sector-style code (one capital letter, optionally "/1": "F", "A/1") is read by its
 *    letter's name, so F, L, M, N, R, S, X and the vowels take "az";
 *  - an acronym (two or more capitals, e.g. "KTE", "MTK") is read by its
 *    first letter's name: F, L, M, N, R, S, X ("ef", "el", "em", ...) take "az";
 *  - any other word takes "az" when it starts with a vowel letter.
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

/** "az Arany", "a Kék", "a KTE Legenda". */
export function withArticle(name: string): string {
  return `${hungarianArticle(name)} ${name}`;
}

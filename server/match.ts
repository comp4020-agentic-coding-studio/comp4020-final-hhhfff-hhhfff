// How two item names are compared. `itemKey` decides "the same item" for the
// one-post-per-person rule; `similarity` decides what to show a poster as a
// possible duplicate before they post.

// "Tim Tams 200 g", "tim-tams 200G" and "TIM TAMS, 200g" all key the same.
export function itemKey(item: string): string {
  return item
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/(\d)\s+(g|kg|ml|l|pk|pack|x)\b/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(key: string): Set<string> {
  const s = ` ${key.replace(/ /g, "")} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

// 0..1. The better of word overlap (catches reordering: "200g tim tams") and
// letter-trigram overlap (catches typos: "tim tam 200g").
export function similarity(a: string, b: string): number {
  const ka = itemKey(a);
  const kb = itemKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const wa = new Set(ka.split(" "));
  const wb = new Set(kb.split(" "));
  const words = overlap(wa, wb) / (wa.size + wb.size - overlap(wa, wb));
  const ta = trigrams(ka);
  const tb = trigrams(kb);
  const letters = (2 * overlap(ta, tb)) / (ta.size + tb.size);
  return Math.max(words, letters);
}

// At or above this, a deal is shown as "is this the same thing?"
export const SIMILAR_ENOUGH = 0.5;

// --- search: what a reader types to find an item or a shop.

// The words of a search, normalised like item names, at most eight.
export function searchTerms(query: string): string[] {
  return [...new Set(itemKey(query).split(" ").filter(Boolean))].slice(0, 8);
}

// Edit distance between a and b, or max + 1 once it's sure to exceed max.
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (Math.min(...row) > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

// How well one search word matches a normalised text, best first: a whole
// word; the start of one ("dump" while typing "dumplings"); the word with an
// ending ("dumplings" for "dumpling"); a run from the
// start of a word across a space ("timtams"); in Chinese and other scripts
// written without spaces, anywhere; or, for a word of five letters or more, a
// slip of a letter (two from eight letters: "dumplngs"). Only from the start of
// a word, so "cola" doesn't find "chocolate", and never a slip in a short word,
// so "cola" doesn't find "Coles". 0 if none; TYPO marks the slip.
const TYPO = 1;
function termScore(term: string, key: string): number {
  const words = key.split(" ");
  if (words.includes(term)) return 3;
  if (words.some((w) => w.startsWith(term))) return 2;
  // a plural or other ending on a word of the item: "dumplings" finds "dumpling", "tomatoes" "tomato"
  if (words.some((w) => w.length >= 3 && term.startsWith(w) && term.length - w.length <= 2)) return 1.8;
  if (/[^\p{Script=Latin}\p{N}.]/u.test(term)) {
    if (key.replace(/ /g, "").includes(term)) return 1.5;
  } else if (words.some((_, i) => words.slice(i).join("").startsWith(term))) return 1.5;
  if (term.length >= 5 && !/\d/.test(term)) {
    const max = term.length >= 8 ? 2 : 1;
    const near = (w: string) =>
      editDistance(term, w, max) <= max || (w.length > term.length && editDistance(term, w.slice(0, term.length), 1) <= 1);
    if (words.some(near)) return TYPO;
  }
  return 0;
}

// score 0 unless every search word matches the item or the store; otherwise
// higher for closer matches, and an item match counts a little more than a
// store one. `typo` says some word only matched as a slip, so the caller can
// leave such matches out when others need no such charity.
export function searchScore(terms: string[], item: string, store: string): { score: number; typo: boolean } {
  const itemK = itemKey(item);
  const storeK = itemKey(store);
  let score = 0;
  let typo = false;
  for (const t of terms) {
    const inItem = termScore(t, itemK);
    const inStore = termScore(t, storeK);
    const best = Math.max(inItem, 0.9 * inStore);
    if (!best) return { score: 0, typo: false };
    if (Math.max(inItem, inStore) === TYPO) typo = true;
    score += best;
  }
  return { score, typo };
}

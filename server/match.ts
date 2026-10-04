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

// Shelf photos are JPEGs only. The page shrinks and re-encodes a photo
// before sending it, which already drops its metadata; this checks the
// result is really a JPEG, reads its size, and drops every metadata segment
// again, so a photo sent some other way can't carry where (or on what
// phone) it was taken either. No image library: the segments are walked by
// hand and the picture data is copied as it came.

export const MAX_SIDE = 4096;

// APP0 (JFIF) and APP14 (Adobe colour transform) are about decoding the
// picture; every other APPn (EXIF and its GPS tags, XMP, IPTC, ICC, maker
// notes) and comments are dropped.
const keep = (marker: number): boolean =>
  !(marker >= 0xe1 && marker <= 0xef && marker !== 0xee) && marker !== 0xfe;

// start-of-frame markers carry the size: C0–CF except DHT (C4), JPG (C8), DAC (CC)
const isFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

export function cleanJpeg(input: Buffer): { data: Buffer; width: number; height: number } | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  if (input[input.length - 2] !== 0xff || input[input.length - 1] !== 0xd9) return null;
  const parts: Buffer[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let at = 2;
  while (at + 4 <= input.length) {
    if (input[at] !== 0xff) return null;
    const marker = input[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    const length = input.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > input.length) return null;
    const segment = input.subarray(at, at + 2 + length);
    if (isFrame(marker)) {
      if (length < 7) return null;
      height = input.readUInt16BE(at + 5);
      width = input.readUInt16BE(at + 7);
    }
    if (marker === 0xda) {
      // start of scan: the picture data runs to the end
      if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) return null;
      parts.push(input.subarray(at));
      return { data: Buffer.concat(parts), width, height };
    }
    if (keep(marker)) parts.push(segment);
    at += 2 + length;
  }
  return null;
}

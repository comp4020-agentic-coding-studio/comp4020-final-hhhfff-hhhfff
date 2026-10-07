import { gunzipSync } from "node:zlib";
import { request } from "node:http";
import { expect, inject, it } from "vitest";

// The page's own files go out gzipped to a browser that asks for it, and
// plain to one that doesn't; either way the bytes are the same file.
// node:http, not fetch, so the body arrives as sent, not unpacked.
const baseUrl = inject("baseUrl");

function get(path: string, encoding: string): Promise<{ headers: Record<string, any>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, baseUrl), { headers: { "accept-encoding": encoding } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

it.runIf(new URL(baseUrl).protocol === "http:")("text files are gzipped when asked, plain when not, and the same either way", async () => {
  for (const path of ["/app.js", "/styles.css", "/"]) {
    const plain = await get(path, "identity");
    const packed = await get(path, "gzip, deflate, br");
    expect(plain.headers["content-encoding"], path).toBeUndefined();
    expect(packed.headers["content-encoding"], path).toBe("gzip");
    expect(packed.headers.vary, path).toMatch(/accept-encoding/i);
    expect(packed.body.length, path).toBeLessThan(plain.body.length);
    expect(gunzipSync(packed.body).equals(plain.body), path).toBe(true);
  }
});

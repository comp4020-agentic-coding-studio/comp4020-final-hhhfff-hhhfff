import { describe, expect, inject, it } from "vitest";
import { baseUrl, call, person, special, writes, type Person } from "./api.ts";

// A post may carry one shelf photo: the tag with the price, what's left and
// the item, in one picture. Only its poster adds or replaces it; it is a
// JPEG, its metadata (GPS and all) is dropped by the server whatever the
// page did, and it goes when the post goes. Ten people reporting it hide it
// until an admin looks, as with a comment.

// an 8×6 JPEG, as Chrome's canvas encodes one (with an ICC profile segment)
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAGAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAiEAABAgMJAAAAAAAAAAAAAAAAERQCBRIVFiIlMjNSVKH/xAAVAQEBAAAAAAAAAAAAAAAAAAAGB//EABsRAAIBBQAAAAAAAAAAAAAAAAIRAAFBYXHw/9oADAMBAAIRAxEAPwCssJreB3bOV9BrBwTcWrVi8ABKiOpJ2wu3ExFUk7YXbn//2Q==",
  "base64",
);

// the same picture with an EXIF segment saying where it was taken
function withGps(): Buffer {
  const payload = Buffer.from("Exif\0\0GPSLatitude -35.2777 GPSLongitude 149.1185 iPhone 15\0");
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([JPEG.subarray(0, 2), head, payload, JPEG.subarray(2)]);
}

async function upload(dealId: number, body: Buffer, as?: Person, type = "image/jpeg") {
  const res = await fetch(new URL(`/api/deals/${dealId}/photo`, baseUrl), {
    method: "POST",
    headers: { "content-type": type, ...(as ? { cookie: as.as.cookie } : {}) },
    body: new Uint8Array(body),
  });
  return { status: res.status, data: await res.json() };
}

const picture = async (dealId: number, as?: { cookie: string }) =>
  fetch(new URL(`/api/deals/${dealId}/photo`, baseUrl), { headers: as ? { cookie: as.cookie } : {} });

describe.skipIf(!writes)("shelf photos", () => {
  it("only the poster adds one; anyone, guests included, can see it, with no location left in it", async () => {
    const [poster, other] = await Promise.all(["spec poster", "spec other"].map(person));
    const { data: deal } = await call("/api/deals", special(poster));
    expect(deal.photo).toBeNull();

    expect((await upload(deal.id, withGps())).status).toBe(401);
    expect((await upload(deal.id, withGps(), other)).status).toBe(403);
    const added = await upload(deal.id, withGps(), poster);
    expect(added.status).toBe(201);
    expect(added.data.photo).toMatchObject({ width: 8, height: 6, hidden: null, at: expect.any(String) });
    expect((await call(`/api/deals/${deal.id}`)).data.photo).toEqual(added.data.photo);

    const res = await picture(deal.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    for (const leak of ["GPS", "149.1185", "iPhone", "Exif", "Google"]) expect(bytes.includes(leak), leak).toBe(false);
  });

  it("refuses what isn't a JPEG, or is too large, whatever it claims to be", async () => {
    const poster = await person("spec poster");
    const { data: deal } = await call("/api/deals", special(poster));
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(deal.id, svg, poster)).status).toBe(400);
    expect((await upload(deal.id, svg, poster, "image/svg+xml")).status).toBe(400);
    expect((await upload(deal.id, JPEG, poster, "image/png")).status).toBe(400);
    expect((await upload(deal.id, JPEG.subarray(0, 400), poster)).status).toBe(400); // cut short
    const huge = Buffer.concat([JPEG.subarray(0, -2), Buffer.alloc(700 * 1024), JPEG.subarray(-2)]);
    expect((await upload(deal.id, huge, poster)).status).toBe(413);
    expect((await call(`/api/deals/${deal.id}`)).data.photo).toBeNull();
    expect((await picture(deal.id)).status).toBe(404);
  });

  it("the poster can replace or remove it, and it goes when the post is deleted", async () => {
    const [poster, other] = await Promise.all(["spec poster", "spec other"].map(person));
    const { data: deal } = await call("/api/deals", special(poster));
    const first = (await upload(deal.id, JPEG, poster)).data.photo;
    await new Promise((r) => setTimeout(r, 5));
    const second = (await upload(deal.id, JPEG, poster)).data.photo;
    expect(second.at > first.at).toBe(true); // a new address, so no stale copy is shown

    expect((await call(`/api/deals/${deal.id}/photo/delete`, { author: other.as })).status).toBe(403);
    expect((await call(`/api/deals/${deal.id}/photo/delete`, { author: poster.as })).data.photo).toBeNull();
    expect((await picture(deal.id)).status).toBe(404);

    await upload(deal.id, JPEG, poster);
    await call(`/api/deals/${deal.id}/delete`, { author: poster.as });
    expect((await picture(deal.id)).status).toBe(404);
  });

  it("ten different reports hide it from everyone but an admin; the poster can't report their own", async () => {
    const poster = await person("spec poster");
    const reporters = await Promise.all(Array.from({ length: 10 }, (_, i) => person(`spec reporter ${i}`)));
    const { data: deal } = await call("/api/deals", special(poster));
    await upload(deal.id, JPEG, poster);

    expect((await call(`/api/deals/${deal.id}/photo/report`, { author: poster.as })).status).toBe(400);
    expect((await call(`/api/deals/${deal.id}/photo/report`, {})).status).toBe(401);
    for (const r of reporters.slice(0, 9)) {
      expect((await call(`/api/deals/${deal.id}/photo/report`, { author: r.as })).status).toBe(201);
    }
    expect((await call(`/api/deals/${deal.id}/photo/report`, { author: reporters[0].as })).status).toBe(200);
    expect((await picture(deal.id)).status).toBe(200);

    await call(`/api/deals/${deal.id}/photo/report`, { author: reporters[9].as });
    expect((await call(`/api/deals/${deal.id}`)).data.photo).toMatchObject({ hidden: "reported" });
    for (const as of [undefined, poster.as]) expect((await picture(deal.id, as)).status).toBe(404);
    expect((await call(`/api/deals/${deal.id}/photo/review`, { decision: "restore", author: poster.as })).status).toBe(403);
  });

  // Needs an app started with this name in ADMIN_USERS (see accounts.test.ts).
  const adminName = inject("adminUser");
  it.skipIf(!adminName)("an admin sees a reported photo in the inbox and can restore it, hide it or remove it", async () => {
    const admin = await adminSession(adminName);
    const poster = await person("spec poster");
    const reporters = await Promise.all(Array.from({ length: 10 }, (_, i) => person(`spec reporter ${i}`)));
    const { data: deal } = await call("/api/deals", special(poster));
    await upload(deal.id, JPEG, poster);
    await Promise.all(reporters.map((r) => call(`/api/deals/${deal.id}/photo/report`, { author: r.as })));

    const mine = async () => ((await call("/api/reports", undefined, admin)).data as any[]).filter((x) => x.deal.id === deal.id);
    expect(await mine()).toEqual([expect.objectContaining({ kind: "photo", photo: expect.objectContaining({ hidden: "reported", reports: 10 }) })]);
    expect((await picture(deal.id, admin)).status).toBe(200);
    expect((await picture(deal.id, admin)).headers.get("cache-control")).toBe("no-store");

    expect((await call(`/api/deals/${deal.id}/photo/review`, { decision: "restore", author: admin })).data.photo).toMatchObject({ hidden: null });
    expect(await mine()).toEqual([]);
    expect((await picture(deal.id)).status).toBe(200);

    await call(`/api/deals/${deal.id}/photo/report`, { author: (await person("spec reporter x")).as });
    expect((await call(`/api/deals/${deal.id}/photo/review`, { decision: "keep", author: admin })).data.photo).toMatchObject({ hidden: "kept" });
    expect((await picture(deal.id)).status).toBe(404);
    expect((await call(`/api/deals/${deal.id}/photo/delete`, { author: admin })).data.photo).toBeNull();
  });
});

async function adminSession(name: string): Promise<{ cookie: string }> {
  const enter = (path: string) => fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: name, password: "spec-password-1" }),
  });
  let res = await enter("/api/register");
  if (res.status !== 201) res = await enter("/api/login");
  return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}

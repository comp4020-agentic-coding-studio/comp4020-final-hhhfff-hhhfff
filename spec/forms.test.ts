import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

// A form control named after a built-in form property is shadowed by it:
// `form.elements.item` is the collection's item() method, not the input, so
// the first version's Post button threw silently (fixed by renaming the field
// "product"). Any name the browser already uses on a form, or on its elements
// collection, is off limits — including in <template> markup.
const baseUrl = inject("baseUrl");

it("no form field is named after a built-in form property", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const { window } = new JSDOM(html);
  const { document } = window;

  const reserved = new Set<string>();
  for (const proto of [
    window.HTMLFormElement.prototype,
    window.HTMLFormControlsCollection.prototype,
    window.HTMLCollection.prototype,
    window.HTMLElement.prototype,
    window.Element.prototype,
    window.Node.prototype,
  ]) {
    for (const key of Object.getOwnPropertyNames(proto)) reserved.add(key);
  }

  const roots: ParentNode[] = [document, ...[...document.querySelectorAll("template")].map((t) => t.content)];
  const names = roots.flatMap((root) =>
    [...root.querySelectorAll("form [name], form [id]")].flatMap((el) =>
      [el.getAttribute("name"), el.getAttribute("id")].filter((n): n is string => !!n),
    ),
  );

  expect(names.length, "found no form fields on / to check").toBeGreaterThan(0);
  expect(names.filter((n) => reserved.has(n))).toEqual([]);
});

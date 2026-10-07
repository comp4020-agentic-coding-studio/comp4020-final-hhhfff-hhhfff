import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

// Colours follow the system unless the visitor picks light or dark with the
// header's button. The choice is kept on their device and applied by
// /theme.js, a classic script in the head, before the styles load, so no page
// flashes the wrong colours first; the About page honours it too.
const baseUrl = inject("baseUrl");

const page = async (path: string) => new JSDOM(await (await fetch(new URL(path, baseUrl))).text()).window.document;

it("both pages load theme.js in the head, before the styles", async () => {
  for (const path of ["/", "/readme/"]) {
    const head = (await page(path)).head;
    const script = head.querySelector('script[src="/theme.js"]');
    const styles = head.querySelector('link[rel="stylesheet"][href="/styles.css"]');
    expect(script, `${path}: no theme.js in the head`).not.toBeNull();
    expect(script!.hasAttribute("type") || script!.hasAttribute("defer") || script!.hasAttribute("async"), `${path}: theme.js must run at once`).toBe(false);
    expect(script!.compareDocumentPosition(styles!) & 4, `${path}: theme.js must come before the styles`).toBeTruthy();
  }
});

it("the header has a theme button saying what it is and what it switches to", async () => {
  const button = (await page("/")).querySelector("header #theme-toggle");
  expect(button, "no #theme-toggle in the header").not.toBeNull();
  expect(button!.getAttribute("type")).toBe("button");
  expect(button!.getAttribute("aria-label")).toMatch(/system.*Switch to light/i);
});

it("theme.js applies a saved light or dark choice, and ignores anything else", async () => {
  const code = await (await fetch(new URL("/theme.js", baseUrl))).text();
  for (const [saved, expected] of [
    ["dark", "dark"],
    ["light", "light"],
    ["purple", undefined],
    [null, undefined],
  ] as const) {
    const { window } = new JSDOM("<!doctype html><html></html>", { url: baseUrl, runScripts: "outside-only" });
    if (saved) window.localStorage.setItem("discountShow.theme", saved);
    window.eval(code);
    expect(window.document.documentElement.dataset.theme, `saved ${saved}`).toBe(expected);
  }
});

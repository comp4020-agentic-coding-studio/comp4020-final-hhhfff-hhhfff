import { describe, expect, it } from "vitest";
import { baseUrl, call, person, special, writes } from "./api.ts";
import { openLogin, openPage, until } from "./page.ts";

// Logging in is a page of its own, /login. Every way in from the feed goes
// there with ?next= naming the page to come back to, and only this site's own
// pages are accepted as `next`: a link to /login can't be used to send someone
// elsewhere after they type their password. ?why= only picks a fixed sentence.

const login = (next: string) => `/login?next=${encodeURIComponent(next)}`;

describe("the login page", () => {
  it("is served the same whatever its address says, with no login form left on the feed", async () => {
    const plain = await fetch(new URL("/login", baseUrl));
    const odd = await fetch(new URL("/login?next=%3Cscript%3E&why=%3Cb%3Ehi%3C%2Fb%3E", baseUrl));
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await plain.text();
    expect(await odd.text()).toBe(html);
    expect(html).toMatch(/<form id="login-form"[^>]*method="post"/);
    expect(html).toMatch(/name="password" type="password"/);

    const feed = await (await fetch(new URL("/", baseUrl))).text();
    expect(feed).not.toContain('id="account"');
    expect(feed).not.toMatch(/type="password"/);
  });

  it("goes back only to this site's own pages, and to the home page for anything else", async () => {
    const kept = ["/", "/deals/12", "/stores", "/stores/coles-civic?page=2", "/?q=milk&page=3"];
    for (const next of kept) {
      const { window, doc } = await openLogin(undefined, { path: login(next) });
      expect(doc.querySelector("#login-back")!.getAttribute("href"), next).toBe(next);
      window.close();
    }
    const refused = [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/",
      "javascript:alert(1)",
      "/\t/evil.example",
      "/stores/../api/me",
      "/login",
      "/readme/",
      "deals/12",
      `/?q=${"a".repeat(300)}`,
    ];
    for (const next of refused) {
      const { window, doc } = await openLogin(undefined, { path: login(next) });
      expect(doc.querySelector("#login-back")!.getAttribute("href"), next).toBe("/");
      window.close();
    }
    const { window, doc } = await openLogin(undefined, { path: login("/deals/12#c") });
    expect(doc.querySelector("#login-back")!.getAttribute("href")).toBe("/deals/12");
    window.close();
  });

  it("says what the account is for from a fixed list, never from the address", async () => {
    const why = async (path: string) => {
      const { window, doc } = await openLogin(undefined, { path });
      const p = doc.querySelector("#login-why")!;
      const out = { text: p.textContent, children: p.children.length };
      window.close();
      return out;
    };
    expect((await why("/login?why=comment")).text).toMatch(/^Log in or create an account to comment\./);
    expect((await why("/login?why=post")).text).toMatch(/to post a special\./);
    const fallback = (await why("/login")).text;
    for (const odd of ["hello", "<b>x</b>", "toString", "__proto__"]) {
      const shown = await why(`/login?why=${encodeURIComponent(odd)}`);
      expect(shown.text, odd).toBe(fallback);
      expect(shown.children, odd).toBe(0);
    }
  });
});

describe.skipIf(!writes)("logging in on it", () => {
  const type = (doc: Document, username: string, password: string) => {
    const form = doc.querySelector<HTMLFormElement>("#login-form")!;
    (form.elements.namedItem("username") as HTMLInputElement).value = username;
    (form.elements.namedItem("password") as HTMLInputElement).value = password;
    form.requestSubmit();
  };
  const error = (doc: Document) => doc.querySelector("#login-error")!.textContent ?? "";

  it("a wrong password says so, empties the password and lets them try again", async () => {
    const someone = await person("spec login");
    const sent: string[] = [];
    const { window, doc, went } = await openLogin(undefined, {
      network: async (path, init, res) => {
        if (init.method === "POST") sent.push(`${path} ${init.body}`);
        return res;
      },
    });
    type(doc, someone.name, "not-the-password");
    await until("the error", () => error(doc) !== "");
    expect(error(doc)).toBe("Wrong username or password.");
    expect(sent).toEqual([`/api/login ${JSON.stringify({ username: someone.name, password: "not-the-password" })}`]);
    expect(doc.querySelector<HTMLInputElement>("[name=password]")!.value).toBe("");
    expect(doc.querySelector<HTMLButtonElement>("#login-submit")!.disabled).toBe(false);
    expect(went).toEqual([]);
    window.close();
  });

  it("the right password goes back to `next`, logged in", async () => {
    const someone = await person("spec login");
    const { window, doc, went } = await openLogin(undefined, { path: login("/stores/coles-civic?page=2") });
    type(doc, someone.name, "spec-password-1");
    await until("leaving", () => went.length > 0);
    expect(went).toEqual(["/stores/coles-civic?page=2"]);
    // the page's own session is now that person
    const me = await (await window.fetch("/api/me")).json();
    expect(me.name).toBe(someone.name);
    window.close();
  });

  it("creating an account uses the same form, and a taken name says so", async () => {
    const taken = await person("spec login");
    const { window, doc, went } = await openLogin(undefined);
    doc.querySelector<HTMLButtonElement>("#login-switch")!.click();
    expect(doc.querySelector("#login-title")!.textContent).toBe("Create an account");
    expect(doc.querySelector("[name=password]")!.getAttribute("autocomplete")).toBe("new-password");
    expect(doc.querySelector<HTMLElement>("#login-rules")!.hidden).toBe(false);
    type(doc, taken.name, "spec-password-1");
    await until("the error", () => error(doc) !== "");
    expect(error(doc)).toBe("That username is taken.");

    const fresh = `spec-new-${crypto.randomUUID().slice(0, 8)}`;
    type(doc, fresh, "spec-password-1");
    await until("leaving", () => went.length > 0);
    expect(went).toEqual(["/"]);
    expect((await (await window.fetch("/api/me")).json()).name).toBe(fresh);
    window.close();
  });

  it("too many tries, or no connection, say so", async () => {
    const limited = await openLogin(undefined, {
      network: async (path, init, res) =>
        init.method === "POST" ? new Response(JSON.stringify({ error: "too many wrong passwords, wait a minute" }), { status: 429 }) : res,
    });
    type(limited.doc, "someone", "whatever-123");
    await until("the error", () => error(limited.doc) !== "");
    expect(error(limited.doc)).toBe("Too many wrong passwords, wait a minute.");
    limited.window.close();

    const offline = await openLogin(undefined, {
      network: async (path, init, res) => {
        if (init.method === "POST") throw new TypeError("Failed to fetch");
        return res;
      },
    });
    type(offline.doc, "someone", "whatever-123");
    await until("the error", () => error(offline.doc) !== "");
    expect(error(offline.doc)).toMatch(/^Couldn't reach discountShow/);
    expect(offline.doc.querySelector<HTMLButtonElement>("#login-submit")!.disabled).toBe(false);
    offline.window.close();
  });

  it("someone already logged in is told as whom, with a way on and a way out", async () => {
    const someone = await person("spec login");
    const { window, doc } = await openLogin(someone, { path: login("/deals/5") });
    expect(doc.querySelector<HTMLElement>("#login-form")!.hidden).toBe(true);
    expect(doc.querySelector("#login-title")!.textContent).toBe("You're logged in");
    expect(doc.querySelector("#login-name")!.textContent).toBe(someone.name);
    expect(doc.querySelector("#login-continue")!.getAttribute("href")).toBe("/deals/5");
    window.close();
  });
});

describe.skipIf(!writes)("the ways in from the feed", () => {
  it("a guest's Log in, and Log in to comment, name the page to come back to", async () => {
    const { data: deal } = await call("/api/deals", special(await person("spec login")));
    const { window, doc } = await openPage(undefined, { path: `/deals/${deal.id}` });
    try {
      expect(doc.querySelector("#show-login")!.getAttribute("href")).toBe(`/login?next=%2Fdeals%2F${deal.id}`);
      expect(doc.querySelector(".login-to-comment")!.getAttribute("href")).toBe(`/login?why=comment&next=%2Fdeals%2F${deal.id}`);
    } finally {
      window.close();
    }
  });

  it("the header's link follows the address as the reader moves through the feed", async () => {
    const { window, doc } = await openPage(undefined, { path: "/?q=milk" });
    try {
      expect(doc.querySelector("#show-login")!.getAttribute("href")).toBe("/login?next=%2F%3Fq%3Dmilk");
      const filter = doc.querySelector<HTMLSelectElement>("#store-filter")!;
      filter.value = "coles-civic";
      filter.dispatchEvent(new window.Event("change"));
      await until("the store's address", () => window.location.pathname === "/stores/coles-civic");
      expect(doc.querySelector("#show-login")!.getAttribute("href")).toBe("/login?next=%2Fstores%2Fcoles-civic%3Fq%3Dmilk");
    } finally {
      window.close();
    }
  });
});

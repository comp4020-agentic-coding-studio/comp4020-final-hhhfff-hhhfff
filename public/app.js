// discountShow: the whole client. No framework, no build step.
//
// Identity is an account: log in with a username and password and the server
// keeps you signed in with an HttpOnly cookie this script never sees. A guest
// can only look; the buttons that write ask them to log in. The server is what
// enforces that, not this file.
// A location, if the visitor shares one, is only used here to sort stores;
// it is never sent to the server.

const ANU = { lat: -35.2777, lon: 149.1185 };
const QUORUM = 3; // must match CORRECTION_QUORUM in server/db.ts

const $ = (sel, root = document) => root.querySelector(sel);

// --- who am I

let me = null; // { id, name, role } once logged in, null for a guest
const isMe = (a) => !!me && a.id === me.id;
const isAdmin = () => me?.role === "admin";
const nameOf = (a) => (isMe(a) ? "you" : a.name);

// --- formatting

const money = (c) => `$${(c / 100).toFixed(2)}`;

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const dayFmt = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" });
const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Canberra" }).format(d);
const dayText = (date) => (date === ymd(new Date()) ? "today" : dayFmt.format(new Date(`${date}T12:00:00`)));
const endsText = (endsOn) => (endsOn ? `ends ${dayText(endsOn)}` : "no end date");

// hours left until midnight in Canberra, when a special ending "today" stops
const canberraClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Canberra", hour: "numeric", minute: "numeric", hourCycle: "h23" });
function hoursToMidnight() {
  const [h, m] = canberraClock.format(new Date()).split(":").map(Number);
  return 24 - h - m / 60;
}

const SOURCE_TEXT = {
  "in-store": "seen in store",
  "store-website": "from the store's site",
  catalogue: "from the catalogue",
  "word-of-mouth": "word of mouth",
};

const STOCK_TEXT = { plenty: "plenty", some: "some", few: "only a few", gone: "sold out" };
const STOCK_LEVEL = { gone: 0, few: 1, some: 2, plenty: 3 }; // which cell of the bar is lit

const FIELD_TEXT = { item: "Item", wasCents: "Usual price", nowCents: "Special price", endsOn: "End date" };
const FIELDS = ["item", "wasCents", "nowCents", "endsOn"];

function valueText(field, v) {
  if (field === "wasCents" || field === "nowCents") return money(v);
  if (field === "endsOn") return v ? dayText(v) : "no end date";
  return v;
}

// Item names compare loosely, like the server's itemKey; everything else exactly.
const loose = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, "");
const sameValue = (field, a, b) => (field === "item" ? loose(a) === loose(b) : a === b);

const toCents = (s) => {
  const t = String(s).trim().replace(/^\$/, "");
  return /^\d{1,4}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
};

// --- api

// The answer and its headers (the feed's total comes in one); most callers want only the answer.
async function apiResponse(path, body) {
  const res = await fetch(path, body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  // the server may know me as someone else now (another tab logged in or out)
  if (res.status === 401 || res.status === 403) syncMe();
  if (!res.ok) throw Object.assign(new Error(data.error ?? `request failed (${res.status})`), { status: res.status, data });
  return { data, headers: res.headers };
}

const api = async (path, body) => (await apiResponse(path, body)).data;

// --- stores, sorted by distance from ANU or from the visitor

let stores = [];
let origin = ANU;
const storeById = () => new Map(stores.map((s) => [s.id, s]));

function km(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const storeLabel = (s) => `${s.name}, ${s.where} (${km(origin, s).toFixed(1)} km)`;

function renderStoreOptions() {
  stores.sort((a, b) => km(origin, a) - km(origin, b));
  const filter = $("#store-filter");
  const picker = $("#post [name=storeId]");
  const [keepFilter, keepPicker] = [filter.value, picker.value];

  filter.replaceChildren(new Option("All stores", ""), ...stores.map((s) => new Option(storeLabel(s), s.id)));
  picker.replaceChildren(new Option("Choose a store", ""), ...stores.map((s) => new Option(storeLabel(s), s.id)));
  filter.value = keepFilter;
  picker.value = keepPicker;
}

$("#locate").addEventListener("click", () => {
  const status = $("#locate-status");
  if (!navigator.geolocation) {
    status.textContent = "This browser can't share a location, so stores stay sorted from ANU.";
    return;
  }
  status.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      origin = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      renderStoreOptions();
      renderFeed();
      status.textContent = "Stores are sorted by distance from you. Your location stays on this device.";
    },
    () => {
      status.textContent = "No location, no problem: stores stay sorted by distance from ANU.";
    },
    { timeout: 10000, maximumAge: 300000 },
  );
});

// --- colours: follow the system, or light, or dark, chosen with the header's
// button and kept on this device (theme.js applies it before the page paints)

const THEMES = ["system", "light", "dark"];
const THEME_TEXT = {
  system: { icon: "◐", name: "follow the system" },
  light: { icon: "☀", name: "light" },
  dark: { icon: "☾", name: "dark" },
};

function showTheme() {
  const now = document.documentElement.dataset.theme ?? "system";
  const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length];
  const button = $("#theme-toggle");
  button.textContent = THEME_TEXT[now].icon;
  const label = `Colours: ${THEME_TEXT[now].name}. Switch to ${THEME_TEXT[next].name}`;
  button.setAttribute("aria-label", label);
  button.title = label;
}

$("#theme-toggle").addEventListener("click", () => {
  const now = document.documentElement.dataset.theme ?? "system";
  const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length];
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try {
    if (next === "system") localStorage.removeItem("discountShow.theme");
    else localStorage.setItem("discountShow.theme", next);
  } catch {
    // private browsing: the choice lasts until the page closes
  }
  showTheme();
});
showTheme();

// --- notifications: what happened to my posts while I was away

async function loadNotices() {
  if (!me) return;
  try {
    const notes = await api("/api/notifications", {});
    if (!notes.length) return;
    const box = $("#notices");
    for (const n of notes) {
      const p = document.createElement("p");
      p.className = "notice";
      p.textContent = `${n.text} (${ago(n.createdAt)})`;
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "quiet small";
      ok.textContent = "Got it";
      ok.addEventListener("click", () => {
        p.remove();
        box.hidden = !box.children.length;
      });
      // a reported comment: an admin decides here, or on the card
      if (n.commentId && isAdmin()) {
        for (const [text, decision] of [["Restore it", "restore"], ["Keep it hidden", "keep"]]) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "small";
          b.textContent = text;
          b.addEventListener("click", async () => {
            try {
              await api(`/api/comments/${n.commentId}/review`, { decision });
              p.textContent = decision === "restore" ? "Restored: everyone can see it again." : "Kept hidden.";
            } catch (err) {
              p.textContent = `Couldn't do that: ${err.message}`;
            }
            p.append(" ", ok);
          });
          p.append(" ", b);
        }
      }
      p.append(" ", ok);
      box.append(p);
    }
    box.hidden = false;
  } catch {
    // notices can wait for the next visit
  }
}

// --- the feed

let deals = [];
let feedRequest = 0; // only the latest request's answer is shown, however they arrive

// Numbered pages of ten. The server sorts and counts (x-total-count); the page
// asks for one page at a time and keeps the number in the address, so Back
// returns to it and a link opens on it.
const PER_PAGE = 10;
let page = 1;
let total = 0;
const lastPage = () => Math.max(1, Math.ceil(total / PER_PAGE));
const pageFromAddress = () =>
  Math.min(100_000, Math.max(1, Number.parseInt(new URLSearchParams(location.search).get("page") ?? "1", 10) || 1));

// what's typed in the search box, tidied; "" when not searching
const query = () => $("#search").value.trim().replace(/\s+/g, " ");

function feedPath() {
  const params = new URLSearchParams();
  if ($("#store-filter").value) params.set("store", $("#store-filter").value);
  if (query()) params.set("q", query());
  params.set("page", page);
  params.set("per", PER_PAGE);
  return `/api/deals?${params}`;
}

// the search and page into the address; `push` makes a step Back can undo
function syncAddress(push) {
  const url = new URL(location.href);
  if (query()) url.searchParams.set("q", query());
  else url.searchParams.delete("q");
  if (page > 1) url.searchParams.set("page", page);
  else url.searchParams.delete("page");
  if (url.href === location.href) return;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

// `motion` animates the swap when the reader turned a page ("next", "prev")
// or changed store ("swap"); live updates and typing don't animate.
async function loadFeed(motion) {
  const feed = $("#feed");
  const status = $("#feed-status");
  const mine = ++feedRequest;
  feed.setAttribute("aria-busy", "true");
  if (!feed.children.length) status.textContent = query() ? "Searching…" : "Loading specials…";
  try {
    const { data, headers } = await apiResponse(feedPath());
    if (mine !== feedRequest) return;
    total = Number(headers.get("x-total-count") ?? data.length);
    // past the end (posts went, or an old link): the last page there is
    if (!data.length && page > lastPage()) {
      page = lastPage();
      syncAddress(false);
      return loadFeed(motion);
    }
    const show = () => {
      deals = data;
      clearWaiting(); // whatever was waiting is in this answer, if it fits
      renderFeed();
    };
    if (motion && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.documentElement.dataset.nav = motion;
      document.startViewTransition(show);
    } else show();
  } catch (err) {
    // on a slow or dropped connection, say so and offer a way back, keeping what's shown
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "quiet small";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => loadFeed());
    feed.querySelectorAll(".skeleton").forEach((bone) => bone.remove());
    status.replaceChildren(`Couldn't load specials: ${err.message}. `, retry);
  } finally {
    if (mine === feedRequest) feed.setAttribute("aria-busy", "false");
  }
}

// Sold-out posts go after the rest, as the server sends them; otherwise newest first.
const shelfOrder = (list) => [...list].sort((a, b) => (a.stock === "gone") - (b.stock === "gone"));

function replaceDeal(updated) {
  deals = deals.map((x) => (x.id === updated.id ? updated : x));
  renderFeed();
}

function renderFeed() {
  deals = shelfOrder(deals);
  const byId = storeById();
  const keep = (sel) => new Set([...document.querySelectorAll(`#feed ${sel}[open]`)].map((d) => d.closest("li").dataset.id));
  const [openComments, openCorrect] = [keep("details.comments"), keep("details.correct")];
  $("#feed").replaceChildren(
    ...deals.map((d) => cardFor(d, byId.get(d.storeId), openComments.has(String(d.id)), openCorrect.has(String(d.id)))),
  );
  [...$("#feed").children].forEach((li, i) => li.style.setProperty("--i", i)); // staggers the stickers' stamp
  renderPager();
  const store = byId.get($("#store-filter").value);
  const q = query();
  const at = store ? ` at ${store.name}, ${store.where}` : "";
  $("#feed-status").textContent = q && total
    ? `${total === 1 ? "1 special matches" : `${total} specials match`} “${q}”${at}.`
    : "";
  // an empty search isn't an empty feed: say so, and offer the way back
  $("#empty-title").textContent = q
    ? `Nothing matches “${q}”${at}`
    : store ? `Nothing shared for ${store.name}, ${store.where} yet` : "No one has shared a special yet";
  $("#empty-hint").textContent = q
    ? "Try fewer words or another spelling, or check the chains' own pages below."
    : "Spotted a markdown in a shop near ANU? Post it and the next student can walk there for it.";
  $("#post-first").hidden = !!q;
  $("#clear-search").hidden = !q;
  showChains();
}

// --- pages: previous, numbers (the first, the last and those either side of
// this one, with "…" between), next; on a phone, "3 / 12" instead of numbers.

function pageNumbers(current, last) {
  const want = [...new Set([1, current - 1, current, current + 1, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const out = [];
  for (const n of want) {
    if (out.length && n - out.at(-1) === 2) out.push(n - 1); // a gap of one page shows the page, not "…"
    else if (out.length && n - out.at(-1) > 2) out.push("…");
    out.push(n);
  }
  return out;
}

function renderPager() {
  const nav = $("#pager");
  const last = lastPage();
  nav.hidden = total <= PER_PAGE;
  if (nav.hidden) return;
  const button = (text, to, label) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "quiet";
    b.textContent = text;
    if (label) b.setAttribute("aria-label", label);
    b.disabled = to < 1 || to > last || to === page;
    b.addEventListener("click", () => goToPage(to));
    return b;
  };
  const numbers = document.createElement("ol");
  numbers.className = "page-numbers";
  for (const n of pageNumbers(page, last)) {
    const li = document.createElement("li");
    if (n === "…") {
      li.className = "gap";
      li.textContent = "…";
    } else {
      const b = button(String(n), n, `Page ${n}`);
      if (n === page) b.setAttribute("aria-current", "page");
      li.append(b);
    }
    numbers.append(li);
  }
  const of = document.createElement("span");
  of.className = "page-of";
  of.textContent = `${page} / ${last}`;
  const prev = button("‹ Previous", page - 1);
  prev.classList.add("prev");
  const next = button("Next ›", page + 1);
  next.classList.add("next");
  const range = document.createElement("p");
  range.className = "hint page-range";
  range.textContent = `Specials ${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, total)} of ${total}`;
  nav.replaceChildren(prev, numbers, of, next, range);
}

function goToPage(n) {
  const motion = n > page ? "next" : "prev";
  page = n;
  syncAddress(true);
  loadFeed(motion);
  // back to the top of the feed, and tell a screen reader where it is
  $("#feed-heading").focus({ preventScroll: true });
  $("#feed-layout").scrollIntoView({ block: "start" });
}

// Back and Forward step through pages and searches
addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search);
  $("#search").value = params.get("q") ?? "";
  page = pageFromAddress();
  loadFeed("swap");
});

// With posts, the chains' links are a sidebar; with none, they fill the middle
// under the empty-feed (or empty-search) note. Hidden until the feed first loads.
function showChains() {
  const empty = !deals.length;
  $("#chains").hidden = false;
  $("#chains").classList.toggle("empty", empty);
  $("#chains-empty").hidden = !empty;
  $("#feed-layout").classList.toggle("has-side", !empty);
}

// the same toggle as the post button, so a guest is asked to log in rather than shown a form
$("#post-first").addEventListener("click", () => toggle.click());

// --- search: typed words go to the server (see searchDeals in server/server.ts),
// a moment after typing stops. The words stay in the address, so a search can
// be shared or reloaded.

let searchTimer;
function searchChanged() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page = 1; // a new search starts at its first page
    syncAddress(false);
    loadFeed();
  }, 150);
}

function clearSearch() {
  $("#search").value = "";
  searchChanged();
  $("#search").focus();
}

$("#search").addEventListener("input", searchChanged);
$("#search").addEventListener("keydown", (e) => e.key === "Escape" && $("#search").value && clearSearch());
$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  $("#search").blur(); // a phone's keyboard steps aside to show the results
});
$("#clear-search").addEventListener("click", clearSearch);

// Marks where the search words appear in `text`, as text nodes and <mark>s
// (never HTML). Approximate: the server matches normalised words, this only
// finds them literally, ignoring case.
function highlighted(text) {
  const words = query().toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter((w) => w.length > 1 || /[^\x00-\x7f]/.test(w));
  if (!words.length) return [text];
  const lower = text.toLowerCase();
  const marks = new Array(text.length).fill(false);
  for (const w of words) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + 1)) marks.fill(true, i, i + w.length);
  }
  const out = [];
  for (let i = 0; i < text.length;) {
    let j = i;
    while (j < text.length && marks[j] === marks[i]) j++;
    const piece = text.slice(i, j);
    if (marks[i]) {
      const m = document.createElement("mark");
      m.textContent = piece;
      out.push(m);
    } else out.push(piece);
    i = j;
  }
  return out;
}

// Built cards, kept so that a search coming back with posts already built
// moves them rather than building them again: building ~200 cards holds up
// typing for a moment on a phone. A card is reused only while its deal, who is
// looking and the minute ("5 min ago") are unchanged, so nothing on it is stale;
// the search marks and the distance are repainted every time.
const built = new Map(); // deal id -> { key, li }
const cardKey = (d) => `${JSON.stringify(d)}|${me?.id ?? ""}|${me?.role ?? ""}|${Math.floor(Date.now() / 60_000)}`;

function cardFor(d, store, commentsOpen, correctOpen) {
  const key = cardKey(d);
  const hit = built.get(d.id);
  if (hit?.key === key) {
    paintNames(hit.li, d, store);
    return hit.li;
  }
  if (built.size > 1000) built.clear(); // a long session doesn't keep every card it ever saw
  const li = dealCard(d, store, commentsOpen, correctOpen);
  built.set(d.id, { key, li });
  // what changed since the card last on screen, played once: a first showing
  // stamps its sticker, going sold out stamps the card, a new level slides in
  const was = hit?.li;
  if (!seen.has(d.id)) play(li, "arrive", 1500);
  else if (was && d.stock === "gone" && !was.classList.contains("sold-out")) play(li, "stamped", 900);
  else if (was && was.dataset.stock !== d.stock) slideLevel(li, was.dataset.stock, d.stock);
  seen.add(d.id);
  return li;
}

const seen = new Set(); // deals whose card has been shown

// A class that plays an animation, taken off afterwards: a cached card put
// back in the feed would otherwise play it again.
function play(el, cls, ms) {
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

// the lit cell of the stock bar slides over from the level reported before
function slideLevel(li, from, to) {
  const [a, b] = [STOCK_LEVEL[from], STOCK_LEVEL[to]];
  if (!a || !b) return; // to or from sold out, which isn't on the bar
  const cell = $(`.meter button[data-stock="${to}"]`, li);
  cell.style.setProperty("--from", `${(a - b) * 100}%`);
  cell.style.transition = "none"; // so its colour doesn't fade in again when the slide ends
  play(cell, "slid", 500);
  const dot = $(".meter.static i.filled", li);
  dot.style.setProperty("--from", `calc(${a - b} * (100% + 3px))`);
  play(dot, "slid", 500);
}

// How fresh a card is: its edge goes green within the hour (with a pulsing
// dot for the last ten minutes), amber within six, then grey. One ending
// today counts down to midnight, red in its last two hours. Repainted in
// place every minute, so a card being typed into is never rebuilt for it.
const MINUTE = 60_000;
function paintFreshness(li) {
  const age = Date.now() - Date.parse(li.dataset.touched);
  li.dataset.fresh = age < 10 * MINUTE ? "now" : age < 60 * MINUTE ? "fresh" : age < 360 * MINUTE ? "recent" : "stale";
  const badge = $(".ends-soon", li);
  badge.hidden = li.dataset.endsOn !== ymd(new Date()) || li.classList.contains("sold-out");
  if (badge.hidden) return;
  const left = hoursToMidnight();
  badge.textContent = left < 1 ? "Ends tonight · under an hour left" : `Ends tonight · ${Math.floor(left)} h left`;
  badge.classList.toggle("urgent", left < 2);
}

setInterval(() => document.querySelectorAll("#feed > li").forEach(paintFreshness), MINUTE);

// the item and store lines, which change with the search and with "Near me"
function paintNames(li, d, store) {
  $(".item", li).replaceChildren(...highlighted(d.item));
  $(".store", li).replaceChildren(...highlighted(store ? `${store.name}, ${store.where}` : d.storeId),
    store ? ` · ${km(origin, store).toFixed(1)} km` : "");
}

function dealCard(d, store, commentsOpen, correctOpen) {
  const li = $("#deal-template").content.firstElementChild.cloneNode(true);
  li.dataset.id = d.id;
  li.id = `deal-${d.id}`;
  li.classList.toggle("sold-out", d.stock === "gone");
  // the last time anyone touched it: posted, reported stock, or corrected
  li.dataset.touched = [d.createdAt, d.stockAt, ...d.history.map((h) => h.at)].sort().at(-1);
  li.dataset.endsOn = d.endsOn ?? "";
  paintFreshness(li);
  paintNames(li, d, store);
  $(".now", li).textContent = money(d.nowCents);
  $(".was", li).textContent = money(d.wasCents);
  // the sticker: "50%" over "off", louder the deeper the cut
  const pct = Math.round((1 - d.nowCents / d.wasCents) * 100);
  const [num, word] = [document.createElement("b"), document.createElement("small")];
  num.textContent = `${pct}%`;
  word.textContent = "off";
  const off = $(".off", li);
  off.replaceChildren(num, " ", word);
  off.dataset.depth = pct >= 50 ? "huge" : pct >= 35 ? "big" : pct >= 20 ? "mid" : "small";
  $(".meta", li).textContent = `${SOURCE_TEXT[d.source]} · ${endsText(d.endsOn)} · by ${nameOf(d.author)}, ${ago(d.createdAt)}`;

  if (isMe(d.author) || isAdmin()) wireDelete(d, li);
  if (!isMe(d.author)) $(".delete-start", li).textContent = "Delete post (admin)";

  // How much is left: of the three levels only the reported one is lit (the
  // card's data-stock colours it). Someone logged in reports by pressing a
  // level; a guest gets the same bar read-only, with the level in words.
  const level = STOCK_LEVEL[d.stock];
  li.dataset.stock = d.stock;
  const group = $(".stock", li);
  const read = $(".stock-read", li);
  group.hidden = !me;
  read.hidden = !!me;
  group.setAttribute("aria-label", `How much ${d.item} is left`);
  for (const b of group.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.stock === d.stock));
    b.classList.toggle("filled", b.dataset.stock === d.stock && b.dataset.stock !== "gone");
    b.addEventListener("click", () => updateStock(d, b.dataset.stock));
  }
  read.querySelectorAll(".meter i").forEach((cell, n) => cell.classList.toggle("filled", n === level - 1));
  $(".level", read).textContent = STOCK_TEXT[d.stock][0].toUpperCase() + STOCK_TEXT[d.stock].slice(1);
  // who said so, and the two reports before, so a sudden flip-flop is visible
  const earlier = d.stockHistory.slice(1, 3).map((r) => `${STOCK_TEXT[r.stock]} (${nameOf(r.by)}, ${ago(r.at)})`);
  $(".stock-by", li).textContent =
    `by ${nameOf(d.stockBy)}, ${ago(d.stockAt)}` + (earlier.length ? `. Before: ${earlier.join(", ")}` : "");

  // confirmations
  const confirmedByMe = d.confirmedBy.some(isMe);
  const others = d.confirmations - (confirmedByMe ? 1 : 0);
  const people = (k) => (k === 1 ? "1 other person" : `${k} other people`);
  $(".confirmed", li).textContent =
    d.confirmations === 0 ? ""
    : confirmedByMe ? `✓ You confirmed this${others ? `, and so did ${people(others)}` : ""}.`
    : `✓ Confirmed by ${d.confirmations === 1 ? "1 person" : `${d.confirmations} people`} besides the poster.`;
  const confirm = $(".confirm", li);
  confirm.hidden = !me || isMe(d.author) || confirmedByMe;
  confirm.addEventListener("click", () => confirmDeal(d.id));
  $(".trust", li).hidden = d.confirmations === 0 && confirm.hidden;

  // what's been corrected
  $(".history", li).replaceChildren(
    ...d.history.map((h) => {
      const item = document.createElement("li");
      item.textContent = `Corrected ${ago(h.at)} by ${h.by === "poster" ? "the poster" : "other shoppers"}: ` +
        `${FIELD_TEXT[h.field].toLowerCase()} was ${valueText(h.field, h.from)}, now ${valueText(h.field, h.to)}.`;
      return item;
    }),
  );

  // open corrections, each with a way to agree
  $(".pending", li).replaceChildren(...d.pending.map((p) => pendingItem(d, p)));

  const correct = $("details.correct", li);
  correct.hidden = !me; // a guest still sees open and applied corrections above
  const form = $(".correct-form", li);
  const fit = () => fitCorrectionInput(form, d);
  form.elements.field.addEventListener("change", fit);
  fit();
  $(".correct-rule", li).textContent = isMe(d.author)
    ? "This is your post, so your correction applies straight away."
    : `When ${QUORUM} people suggest the same correction, the post changes and the poster is told.`;
  form.addEventListener("submit", (e) => submitCorrection(e, d));
  if (correctOpen) correct.open = true;

  const details = $("details.comments", li);
  $("summary", details).textContent = d.comments === 1 ? "1 comment" : `${d.comments} comments`;
  details.addEventListener("toggle", () => details.open && loadComments(d.id, li));
  $(".comment-form", li).addEventListener("submit", (e) => postComment(e, d.id, li));
  $(".reply-cancel", li).addEventListener("click", () => stopReply(li));
  $(".comment-form", li).hidden = !me;
  const loginToComment = $(".login-to-comment", li);
  loginToComment.hidden = !!me;
  loginToComment.addEventListener("click", () => requireLogin("comment"));
  if (commentsOpen) details.open = true;
  return li;
}

// Deleting asks first, on the card itself, and says what else goes with it.
function wireDelete(d, li) {
  const box = $(".delete", li);
  const start = $(".delete-start", box);
  const ask = $(".delete-confirm", box);
  box.hidden = false;

  const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const others = [
    d.confirmations && plural(d.confirmations, "confirmation", "confirmations"),
    d.comments && plural(d.comments, "comment", "comments"),
    d.pending.length && plural(d.pending.length, "open correction", "open corrections"),
  ].filter(Boolean);
  $(".delete-warning", box).textContent =
    "Delete this post? It disappears for everyone." +
    (others.length
      ? ` It has ${others.length > 1 ? `${others.slice(0, -1).join(", ")} and ${others.at(-1)}` : others[0]} from other people, which will be hidden too.`
      : "");

  start.addEventListener("click", () => {
    start.hidden = true;
    ask.hidden = false;
    $(".delete-no", box).focus();
  });
  $(".delete-no", box).addEventListener("click", () => {
    ask.hidden = true;
    start.hidden = false;
    start.focus();
  });
  $(".delete-yes", box).addEventListener("click", async () => {
    try {
      await api(`/api/deals/${d.id}/delete`, {});
      built.delete(d.id);
      deals = deals.filter((x) => x.id !== d.id);
      renderFeed();
      await loadFeed(); // the next post moves up to fill the page
      $("#feed-status").textContent = `Deleted “${d.item}”.`;
    } catch (err) {
      alertIn(box, err.message);
    }
  });
}

function pendingItem(d, p) {
  const item = document.createElement("li");
  const mine = p.voters.some(isMe);
  const others = p.voters.filter((v) => v.id !== d.author.id).length;
  const text = document.createElement("span");
  text.textContent = `${FIELD_TEXT[p.field]} should be ${valueText(p.field, p.value)}? ` +
    `${others} of ${QUORUM} agree${mine ? " (including you)" : ""}.` +
    (p.notes.length ? ` “${p.notes.join("” “")}”` : "");
  item.append(text);
  if (me && !mine) {
    const agree = document.createElement("button");
    agree.type = "button";
    agree.className = "quiet small";
    agree.textContent = isMe(d.author) ? "Accept, it's right" : "Agree";
    agree.addEventListener("click", () => sendCorrection(d, p.field, p.value, null, item));
    item.append(" ", agree);
  }
  return item;
}

// The "it should be" input changes shape with the field being corrected.
function fitCorrectionInput(form, d) {
  const field = form.elements.field.value;
  const input = form.elements.value;
  input.value = "";
  input.type = field === "endsOn" ? "date" : "text";
  input.inputMode = field === "wasCents" || field === "nowCents" ? "decimal" : "";
  input.required = field !== "endsOn";
  input.min = field === "endsOn" ? ymd(new Date()) : "";
  input.placeholder = field === "item" ? d.item : field === "endsOn" ? "" : (d[field] / 100).toFixed(2);
}

function readCorrection(form) {
  const field = form.elements.field.value;
  const raw = form.elements.value.value.trim();
  if (field === "wasCents" || field === "nowCents") {
    const c = toCents(raw);
    if (Number.isNaN(c)) throw new Error("A price should look like 2.75.");
    return { field, value: c };
  }
  if (field === "endsOn") return { field, value: raw || null };
  if (raw.length < 2) throw new Error("What should the item be called?");
  return { field, value: raw };
}

async function submitCorrection(e, d) {
  e.preventDefault();
  const form = e.target;
  let c;
  try {
    c = readCorrection(form);
  } catch (err) {
    return alertIn(form, err.message);
  }
  sendCorrection(d, c.field, c.value, form.elements.note.value.trim() || null, form);
}

async function sendCorrection(d, field, value, note, where) {
  if (!requireLogin()) return;
  try {
    const r = await api(`/api/deals/${d.id}/corrections`, { field, value, note });
    replaceDeal(r.deal);
    $("#feed-status").textContent = r.applied
      ? `Corrected: ${FIELD_TEXT[field].toLowerCase()} is now ${valueText(field, value)}.`
      : `Suggestion recorded: ${r.votes} of ${r.needed} needed agree so far.`;
  } catch (err) {
    alertIn(where, err.message);
  }
}

async function confirmDeal(id) {
  if (!requireLogin()) return;
  try {
    replaceDeal(await api(`/api/deals/${id}/confirm`, {}));
    buzz();
    plusOne(id);
  } catch (err) {
    $("#feed-status").textContent = err.message;
  }
}

async function updateStock(d, stock) {
  if (!requireLogin()) return;
  try {
    replaceDeal(await api(`/api/deals/${d.id}/stock`, { stock }));
    buzz();
  } catch (err) {
    $("#feed-status").textContent = err.message;
  }
}

// A small acknowledgement for adding to a post: a light buzz on a phone that
// can, and a "+1" that floats up from the confirmations.
const buzz = () => navigator.vibrate?.(15);

function plusOne(id) {
  const where = document.querySelector(`#deal-${id} .trust`);
  if (!where) return;
  const plus = document.createElement("span");
  plus.className = "plus-one";
  plus.textContent = "+1";
  plus.setAttribute("aria-hidden", "true");
  where.append(plus);
  setTimeout(() => plus.remove(), 1200); // not on animationend, which reduced motion never fires
}

// --- comments: one level of replies (a reply to a reply sits under the same
// comment, "@" whom it answers), likes, reports, and deleting your own along
// with everything that answers it. A comment ten people reported is hidden
// until an admin restores it or keeps it hidden; only an admin sees its text.

const countText = (n) => (n === 1 ? "1 comment" : `${n} comments`);

async function loadComments(id, li) {
  const list = $(".comment-list", li);
  try {
    const comments = await api(`/api/deals/${id}/comments`);
    list.replaceChildren(...comments.map((c) => commentItem(c, comments, id, li)));
    $("details.comments summary", li).textContent = countText(comments.length);
    const d = deals.find((x) => x.id === id);
    if (d) d.comments = comments.length;
  } catch (err) {
    list.textContent = `Couldn't load comments: ${err.message}`;
  }
}

function commentItem(c, all, dealId, li) {
  const item = document.createElement("li");
  item.className = "comment";
  item.classList.toggle("reply", c.parentId !== null);
  item.classList.toggle("is-hidden", !!c.hidden);
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = `${nameOf(c.author)} · ${ago(c.createdAt)}`;
  const body = document.createElement("p");
  if (c.replyTo) {
    const at = document.createElement("span");
    at.className = "at";
    at.textContent = `@${nameOf(c.replyTo)} `;
    body.append(at);
  }
  const hiddenNote = c.hidden === "kept" ? "Hidden by an admin." : "Hidden after reports, waiting for an admin.";
  if (c.body === null) body.append(hiddenNote);
  else body.append(c.body);
  item.append(who, body);
  if (c.body !== null && c.hidden) {
    // what an admin sees: the text, and why it's hidden
    const why = document.createElement("p");
    why.className = "hint";
    why.textContent = `${hiddenNote} ${c.reports ?? 0} reports since it was last reviewed.`;
    item.append(why);
  }

  const bar = document.createElement("div");
  bar.className = "comment-actions";
  const button = (text, cls, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `quiet small ${cls}`;
    b.textContent = text;
    b.addEventListener("click", onClick);
    bar.append(b);
    return b;
  };
  const done = () => loadComments(dealId, li);
  const send = (path, body) => api(path, body).then(done, (err) => alertIn(item, err.message));
  const mine = isMe(c.author);

  // likes: a button for someone who may like it, otherwise just the count
  if (me && !mine && !c.hidden) {
    const like = button(`♥ ${c.likes}`, "like", () => send(`/api/comments/${c.id}/like`, { liked: !c.liked }));
    like.setAttribute("aria-pressed", String(c.liked));
    like.setAttribute("aria-label", `${c.liked ? "Unlike" : "Like"}, ${c.likes} ${c.likes === 1 ? "like" : "likes"}`);
  } else if (c.likes) {
    const count = document.createElement("span");
    count.className = "likes";
    count.textContent = `♥ ${c.likes}`;
    count.setAttribute("aria-label", `${c.likes} ${c.likes === 1 ? "like" : "likes"}`);
    bar.append(count);
  }
  if (me && !c.hidden) button("Reply", "reply-start", () => startReply(li, c));
  if (me && !mine && !c.hidden) {
    if (c.reported) {
      const note = document.createElement("span");
      note.className = "hint";
      note.textContent = "You reported this";
      bar.append(note);
    } else {
      button("Report", "report", () =>
        ask(item, "Report this comment as rude, spam or off-topic? Ten reports hide it until an admin looks.",
          "Report it", () => send(`/api/comments/${c.id}/report`, {})));
    }
  }
  if (me && (mine || isAdmin())) {
    const replies = all.filter((x) => x.parentId === c.id).length;
    const warning = c.parentId === null
      ? replies ? `Delete this comment and its ${replies === 1 ? "reply" : `${replies} replies`}?` : "Delete this comment?"
      : "Delete this reply, and any replies answering it?";
    button(mine ? "Delete" : "Delete (admin)", "delete-comment", () =>
      ask(item, warning, "Yes, delete", () => send(`/api/comments/${c.id}/delete`, {})));
  }
  if (c.hidden && isAdmin()) {
    button("Restore", "restore", () => send(`/api/comments/${c.id}/review`, { decision: "restore" }));
    if (c.hidden === "reported") button("Keep hidden", "keep", () => send(`/api/comments/${c.id}/review`, { decision: "keep" }));
  }
  if (bar.children.length) item.append(bar);
  return item;
}

// asks on the comment itself before something that can't be undone
function ask(item, question, yes, onYes) {
  $(":scope > .comment-confirm", item)?.remove();
  const box = document.createElement("div");
  box.className = "comment-confirm";
  box.setAttribute("role", "group");
  const p = document.createElement("p");
  p.textContent = question;
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "small danger";
  ok.textContent = yes;
  ok.addEventListener("click", () => {
    box.remove();
    onYes();
  });
  const no = document.createElement("button");
  no.type = "button";
  no.className = "quiet small";
  no.textContent = "Cancel";
  no.addEventListener("click", () => box.remove());
  box.append(p, ok, " ", no);
  item.append(box);
  no.focus();
}

// Replying uses the card's one comment box, which says whom it answers.
function startReply(li, c) {
  const form = $(".comment-form", li);
  form.dataset.replyTo = c.id;
  const chip = $(".replying", li);
  $(".replying-to", chip).textContent = `Replying to @${nameOf(c.author)}`;
  chip.hidden = false;
  form.elements.body.focus();
}

function stopReply(li) {
  delete $(".comment-form", li).dataset.replyTo;
  $(".replying", li).hidden = true;
}

async function postComment(e, id, li) {
  e.preventDefault();
  if (!requireLogin()) return;
  const form = e.target;
  const input = form.elements.body;
  if (!input.value.trim()) return input.focus();
  const replyTo = form.dataset.replyTo ? Number(form.dataset.replyTo) : undefined;
  try {
    await api(`/api/deals/${id}/comments`, { body: input.value, replyTo });
    input.value = "";
    stopReply(li);
    loadComments(id, li);
  } catch (err) {
    alertIn(li, err.message);
  }
}

function alertIn(container, message) {
  let p = $(":scope > .error", container);
  if (!p) {
    p = document.createElement("p");
    p.className = "error";
    p.setAttribute("role", "alert");
    container.append(p);
  }
  p.textContent = message;
}

// --- account

const authForm = $("#auth");
const account = $("#account");
const WHY = $("#auth-why").textContent;

function showMe() {
  $("#who").textContent = me ? `${me.name}${isAdmin() ? " (admin)" : ""}` : "";
  $("#show-login").hidden = !!me;
  $("#logout").hidden = !me;
  if (me) hideAuth();
  // a guest's post button says what it takes, rather than opening a form they can't send
  $("#post-toggle").textContent = me ? "+ Post a special" : "Log in to post a special";
}

// `why` says what the visitor was trying to do when they were asked to log in
function showAuth(why = "") {
  account.hidden = false;
  $("#show-login").setAttribute("aria-expanded", "true");
  $("#auth-why").textContent = why ? `${why} Reading stays free.` : WHY;
  $("#auth-error").textContent = "";
  account.scrollIntoView({ block: "nearest" });
  authForm.elements.username.focus();
}

function hideAuth({ refocus = false } = {}) {
  account.hidden = true;
  $("#show-login").setAttribute("aria-expanded", "false");
  if (refocus) $("#show-login").focus();
}

// The session cookie is shared by every tab, so another tab can log in or out
// as someone else. Ask the server who I am and catch up if it differs.
async function syncMe() {
  const now = await api("/api/me").catch(() => undefined);
  if (now === undefined || (now?.id ?? null) === (me?.id ?? null)) return; // offline, or unchanged
  me = now;
  if (!me) {
    $("#notices").replaceChildren();
    $("#notices").hidden = true;
  }
  showMe();
  connectLive();
  await loadFeed();
  loadNotices();
}

// Writes need an account: say so, and open the login form.
function requireLogin(what = "do that") {
  if (me) return true;
  showAuth(`Log in or create an account to ${what}.`);
  return false;
}

async function enter(path) {
  const error = $("#auth-error");
  error.textContent = "";
  try {
    me = await api(path, { username: authForm.elements.username.value, password: authForm.elements.password.value });
    authForm.reset();
    showMe();
    connectLive(); // so this connection gets my own notices
    await loadFeed();
    loadNotices();
  } catch (err) {
    error.textContent = err.message;
  }
}

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  enter("/api/login");
});
$("#register-btn").addEventListener("click", () => enter("/api/register"));
$("#auth-cancel").addEventListener("click", () => hideAuth({ refocus: true }));
account.addEventListener("keydown", (e) => e.key === "Escape" && hideAuth({ refocus: true }));
$("#show-login").addEventListener("click", () => (account.hidden ? showAuth() : hideAuth()));
$("#logout").addEventListener("click", async () => {
  await api("/api/logout", {}).catch(() => {});
  me = null;
  $("#notices").replaceChildren();
  $("#notices").hidden = true;
  closePost();
  showMe();
  connectLive();
  await loadFeed();
});

// --- posting a special: check for one already in the feed first

const post = $("#post");
const similar = $("#similar");
let draft = null; // the special being posted, while #similar asks about it

$("#next-tuesday").addEventListener("click", () => {
  const d = new Date();
  d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7));
  post.elements.endsOn.value = ymd(d);
});

post.elements.endsOn.min = ymd(new Date());

function readDraft() {
  const f = post.elements;
  const wasCents = toCents(f.was.value);
  const nowCents = toCents(f.now.value);
  const problem =
    !f.storeId.value ? "Which store was it?"
    : f.product.value.trim().length < 2 ? "What's the item?"
    : Number.isNaN(wasCents) ? "The usual price should look like 5.50."
    : Number.isNaN(nowCents) ? "The special price should look like 2.75."
    : nowCents >= wasCents ? "The special price has to be lower than the usual price."
    : "";
  if (problem) throw new Error(problem);
  return {
    storeId: f.storeId.value,
    item: f.product.value.trim(),
    wasCents,
    nowCents,
    endsOn: f.endsOn.value || null,
    stock: f.stock.value,
    source: f.source.value,
  };
}

post.addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#post-error");
  error.textContent = "";
  if (!requireLogin("post a special")) {
    error.textContent = "Log in first (top of the page).";
    return;
  }
  try {
    draft = readDraft();
    const params = new URLSearchParams({ store: draft.storeId, item: draft.item });
    const matches = await api(`/api/deals/similar?${params}`);
    if (matches.length) return showSimilar(matches);
    await publish();
  } catch (err) {
    error.textContent = err.message;
  }
});

// The form is folded behind #post-toggle until someone wants to post; while
// it (or the "already posted?" check) is open, the toggle steps aside.
const toggle = $("#post-toggle");

// On a phone the form is a sheet over the feed (see styles.css): a backdrop
// behind it closes it, and the page under it holds still.
const backdrop = $("#sheet-backdrop");
function sheet(open) {
  backdrop.hidden = !open;
  document.body.classList.toggle("sheet-open", open);
}
backdrop.addEventListener("click", () => closePost({ refocus: true }));

function openPost() {
  sheet(true);
  similar.hidden = true;
  post.hidden = false;
  toggle.hidden = true;
  toggle.setAttribute("aria-expanded", "true");
  post.elements.storeId.focus();
}

function closePost({ refocus = false } = {}) {
  sheet(false);
  similar.hidden = true;
  post.hidden = true;
  toggle.hidden = false;
  toggle.setAttribute("aria-expanded", "false");
  $("#post-error").textContent = "";
  if (refocus) toggle.focus();
}

toggle.addEventListener("click", () => requireLogin("post a special") && openPost());
$("#post-close").addEventListener("click", () => closePost({ refocus: true }));
for (const panel of [post, similar]) {
  panel.addEventListener("keydown", (e) => e.key === "Escape" && closePost({ refocus: true }));
}

function showSimilar(matches) {
  $("#similar-list").replaceChildren(...matches.map(similarItem));
  // the server allows one live post per item per store, whoever posted it, so
  // "post mine" only makes sense when none of these is the same item
  $("#post-anyway").hidden = matches.some((m) => m.score === 1);
  post.hidden = true;
  similar.hidden = false;
  similar.focus();
}

// the special has been dealt with (posted, confirmed or corrected): fold up
function closeSimilar(message) {
  closePost();
  draft = null;
  if (message) $("#feed-status").textContent = message;
}

function similarItem(m) {
  const li = document.createElement("li");
  li.className = "similar-item";
  const head = document.createElement("p");
  const name = document.createElement("strong");
  name.textContent = m.item;
  const meta = document.createElement("span");
  meta.className = "hint";
  meta.textContent = `posted by ${nameOf(m.author)}, ${ago(m.createdAt)}` +
    (m.confirmations ? ` · confirmed by ${m.confirmations}` : "");
  head.append(name, " ", meta);
  li.append(head);

  // yours against theirs, field by field
  const table = document.createElement("table");
  const headRow = table.createTHead().insertRow();
  for (const text of ["", "Posted", "Yours"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    headRow.append(th);
  }
  table.createTBody();
  const differs = [];
  for (const field of FIELDS) {
    const same = sameValue(field, m[field], draft[field]);
    if (!same) differs.push(field);
    const tr = document.createElement("tr");
    tr.className = same ? "" : "differs";
    for (const [tag, text] of [["th", FIELD_TEXT[field]], ["td", valueText(field, m[field])], ["td", valueText(field, draft[field])]]) {
      const cell = document.createElement(tag);
      if (tag === "th") cell.scope = "row";
      cell.textContent = text;
      tr.append(cell);
    }
    table.tBodies[0].append(tr);
  }
  li.append(table);

  const actions = document.createElement("div");
  actions.className = "actions";
  const button = (text, cls, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    actions.append(b);
    return b;
  };

  if (isMe(m.author)) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = differs.length
      ? "This is your own post. Change it with a correction rather than posting it again."
      : "This is your own post, and it already says all this.";
    li.append(p);
    if (differs.length) button("Correct my post", "", () => applyDifferences(m, differs, li));
    button("Show it", "quiet", () => {
      closeSimilar();
      jumpTo(m.id);
    });
  } else {
    if (!differs.length || differs.every((f) => f === "endsOn" && !draft.endsOn)) {
      button("Same thing, and it's right", "", () => confirmFromDraft(m, li));
    } else {
      button("Same thing, and the post is right", "", () => confirmFromDraft(m, li));
      button(`Same thing, but ${differs.length === 1 ? "this needs" : "these need"} correcting`, "quiet", () =>
        applyDifferences(m, differs, li),
      );
    }
  }
  li.append(actions);
  return li;
}

async function confirmFromDraft(m, li) {
  try {
    replaceOrAdd(await api(`/api/deals/${m.id}/confirm`, {}));
    clearPost();
    closeSimilar(`Thanks: you confirmed “${m.item}” instead of posting it twice.`);
    jumpTo(m.id);
  } catch (err) {
    alertIn(li, err.message);
  }
}

// one correction per field where the draft disagrees with the post
async function applyDifferences(m, fields, li) {
  try {
    let latest = null;
    const lines = [];
    for (const field of fields) {
      if (field === "endsOn" && !draft.endsOn) continue; // not knowing the end date isn't a correction
      const r = await api(`/api/deals/${m.id}/corrections`, {
        field,
        value: draft[field],
        note: null,
      });
      latest = r.deal;
      lines.push(`${FIELD_TEXT[field].toLowerCase()} ${r.applied ? "corrected" : `suggested (${r.votes} of ${r.needed} agree)`}`);
    }
    if (latest) replaceOrAdd(latest);
    clearPost();
    closeSimilar(lines.length ? `On “${m.item}”: ${lines.join("; ")}.` : "Nothing to correct.");
    jumpTo(m.id);
  } catch (err) {
    alertIn(li, err.message);
  }
}

$("#post-anyway").addEventListener("click", async () => {
  try {
    await publish();
  } catch (err) {
    alertIn(similar, err.message);
  }
});

$("#similar-cancel").addEventListener("click", () => {
  draft = null;
  openPost();
  post.elements.product.focus();
});

async function publish() {
  try {
    const deal = await api("/api/deals", draft);
    notWaiting(deal.id);
    clearPost();
    replaceOrAdd(deal);
    closeSimilar(`Posted “${deal.item}”.`);
    jumpTo(deal.id);
    glow(deal.id, "landed");
  } catch (err) {
    // the server's one-post-per-item-per-store rule: show the post that's already there
    if (err.status === 409 && err.data.existing) {
      showSimilar([{ ...err.data.existing, score: 1 }]);
      return;
    }
    throw err;
  }
}

function clearPost() {
  for (const name of ["product", "was", "now", "endsOn"]) post.elements[name].value = "";
}

function replaceOrAdd(deal) {
  const filter = $("#store-filter").value;
  if (filter && filter !== deal.storeId) return;
  if (deals.some((x) => x.id === deal.id)) replaceDeal(deal);
  else {
    // a new post is the newest, so it's on page one: go there to show it
    if (page !== 1) {
      page = 1;
      syncAddress(true);
    }
    deals = [deal, ...deals].slice(0, PER_PAGE);
    total += 1;
    renderFeed();
  }
}

function jumpTo(id) {
  const card = document.getElementById(`deal-${id}`);
  if (!card) return;
  card.scrollIntoView({ block: "center" });
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1600);
}

// --- live: the server only says which deal changed; fetch it and swap that card

let live = null;

function connectLive() {
  live?.close();
  if (!window.EventSource) return; // the tab-focus refresh below still works
  const source = (live = new EventSource("/api/events"));
  let opened = false;
  source.addEventListener("open", () => {
    // a reconnect may have missed events, so catch up
    if (opened) {
      loadFeed();
      loadNotices();
    }
    opened = true;
  });
  source.addEventListener("message", (e) => {
    try {
      onLive(JSON.parse(e.data));
    } catch {
      // not an event we know: ignore it
    }
  });
}

// --- the store map: real streets (public/streets.json, built once from
// OpenStreetMap by scripts/streets.ts), each store a dot sized by its live
// specials. Drag to pan; wheel, pinch, double-click or the buttons to zoom.

const SVG = "http://www.w3.org/2000/svg";
const AREAS = [
  { name: "Civic", lat: -35.2822, lon: 149.1305 },
  { name: "Braddon", lat: -35.2685, lon: 149.1352 },
  { name: "Acton", lat: -35.2745, lon: 149.1222 },
  { name: "O'Connor", lat: -35.2615, lon: 149.1195 },
  { name: "Ainslie", lat: -35.2645, lon: 149.1478 },
  { name: "Dickson", lat: -35.2512, lon: 149.1452 },
  { name: "Lyneham", lat: -35.2495, lon: 149.1235 },
];
// drawn bottom to top; roads get a darker casing under their fill
const MAP_LAYERS = ["water", "green", "buildings", "path", "service", "minor", "mid", "major"];
const CASED = new Set(["service", "minor", "mid", "major"]);

let streets = null; // the street map, once loaded
let streetsLoading = null;
// what's in view: the map units at the frame's top-left corner, and map units per screen pixel
const view = { x: 0, y: 0, u: 1, placed: false };

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const mapAt = (p) => {
  const cos = Math.cos((streets.latRef * Math.PI) / 180);
  return { x: (p.lon - streets.box.west) * cos * streets.scale, y: (streets.box.north - p.lat) * streets.scale };
};

function loadStreets() {
  streetsLoading ??= fetch("/streets.json")
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((data) => {
      streets = data;
      drawStreets();
    })
    .catch(() => {
      streetsLoading = null; // a later open tries again
      $("#map-status").textContent = "The street map didn't load. Try closing and opening it again.";
    });
  return streetsLoading;
}

// The streets are drawn once; only the view and the store dots change after.
function drawStreets() {
  const svg = $("#map-svg");
  const base = svgEl("g", { class: "map-base" });
  base.append(svgEl("rect", { class: "map-ground", width: streets.width, height: streets.height }));
  for (const layer of MAP_LAYERS) {
    const d = streets.layers[layer];
    if (!d) continue;
    if (CASED.has(layer)) base.append(svgEl("path", { d, class: `map-${layer} casing` }));
    base.append(svgEl("path", { d, class: `map-${layer}` }));
  }
  const defs = svgEl("defs");
  const labels = svgEl("g", { class: "map-labels" });
  streets.labels.forEach((l, i) => {
    defs.append(svgEl("path", { id: `road-${i}`, d: l.d }));
    const t = svgEl("text", { "data-rank": l.rank, dy: "0.35em" });
    const along = svgEl("textPath", { href: `#road-${i}`, startOffset: "50%", "text-anchor": "middle" });
    along.textContent = l.name;
    t.append(along);
    labels.append(t);
  });
  const areas = svgEl("g", { class: "map-areas" });
  for (const a of AREAS) {
    const t = svgEl("text", { "text-anchor": "middle", "data-x": mapAt(a).x, "data-y": mapAt(a).y });
    t.textContent = a.name;
    areas.append(t);
  }
  svg.replaceChildren(defs, base, labels, areas, svgEl("g", { class: "map-pins" }));
  // a road's label shows only when the road is long enough on screen to hold it
  for (const [i, t] of [...labels.children].entries()) {
    t.dataset.len = String(defs.children[i].getTotalLength());
    t.dataset.wants = String(streets.labels[i].name.length * 6.4);
  }
  $("#map-status").textContent = "";
  if (!view.placed) fitStores();
  drawMap();
}

// The first view frames ANU and every store, as close as fits.
function fitStores() {
  const svg = $("#map-svg");
  const pts = [ANU, ...stores].map(mapAt);
  const [x0, x1] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
  const [y0, y1] = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
  const [w, h] = [svg.clientWidth || 360, svg.clientHeight || 400];
  const pad = 28;
  view.u = Math.max((x1 - x0) / (w - 2 * pad), (y1 - y0) / (h - 2 * pad));
  view.x = (x0 + x1) / 2 - (w / 2) * view.u;
  view.y = (y0 + y1) / 2 - (h / 2) * view.u;
  view.placed = true;
}

// Keeps the zoom between "the whole map fits" and street level, and the map in view.
function clampView() {
  const svg = $("#map-svg");
  const [w, h] = [svg.clientWidth || 360, svg.clientHeight || 400];
  const most = Math.max(streets.width / w, streets.height / h);
  const centre = { x: view.x + (w / 2) * view.u, y: view.y + (h / 2) * view.u };
  view.u = Math.min(Math.max(view.u, 0.12), most);
  const fit = (c, size, span) => (span * view.u >= size ? size / 2 : Math.min(Math.max(c, (span / 2) * view.u), size - (span / 2) * view.u));
  view.x = fit(centre.x, streets.width, w) - (w / 2) * view.u;
  view.y = fit(centre.y, streets.height, h) - (h / 2) * view.u;
}

function zoomAt(px, py, factor) {
  const [ux, uy] = [view.x + px * view.u, view.y + py * view.u];
  view.u /= factor;
  view.x = ux - px * view.u;
  view.y = uy - py * view.u;
  placeView();
}

// Sets the view box, and keeps text, lines and dots their size on screen
// (roads widen to their real width when zoomed in close).
function placeView() {
  if (!streets) return;
  clampView();
  const svg = $("#map-svg");
  const [w, h] = [svg.clientWidth, svg.clientHeight];
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${w * view.u} ${h * view.u}`);
  svg.style.setProperty("--u", String(view.u));
  const ppu = 1 / view.u;
  for (const t of $(".map-labels", svg).children) {
    const room = Number(t.dataset.len) * ppu >= Number(t.dataset.wants) + 24;
    t.toggleAttribute("hidden", !room || (t.dataset.rank === "2" && ppu < 0.9));
  }
  for (const t of $(".map-areas", svg).children) t.setAttribute("transform", `translate(${t.dataset.x} ${t.dataset.y}) scale(${view.u})`);
  placePins();
}

let pins = [];

function drawMap() {
  if (!streets) return void loadStreets();
  const svg = $("#map-svg");
  const chosen = $("#store-filter").value;
  const anu = svgEl("g", { class: "map-anu", "data-x": mapAt(ANU).x, "data-y": mapAt(ANU).y });
  const anuLabel = svgEl("text", { y: -11, "text-anchor": "middle" });
  anuLabel.textContent = "ANU";
  anu.append(svgEl("rect", { x: -6, y: -6, width: 12, height: 12, rx: 2, transform: "rotate(45)" }), anuLabel);

  // fullest drawn last, so it stays on top
  pins = [...stores]
    .sort((a, b) => a.live - b.live)
    .map((s) => {
      const g = svgEl("g", {
        class: "map-store",
        tabindex: 0,
        role: "button",
        "data-live": s.live ? "yes" : "no",
        "aria-pressed": String(s.id === chosen),
        "data-store": s.id,
      });
      const what = `${s.name}, ${s.where}: ${s.live ? `${s.live} live special${s.live === 1 ? "" : "s"}` : "nothing live"}`;
      g.setAttribute("aria-label", what);
      const tip = svgEl("title");
      tip.textContent = what;
      const r = s.live ? 10 + 3 * Math.sqrt(s.live) : 6;
      g.append(tip, svgEl("circle", { r }));
      if (s.live) {
        const n = svgEl("text", { "text-anchor": "middle", dy: "0.35em" });
        n.textContent = String(s.live);
        g.append(n);
      }
      return { g, r, at: mapAt(s) };
    });
  // redrawing mustn't lose the keyboard's place
  const focused = svg.contains(document.activeElement) && document.activeElement.dataset.store;
  $(".map-pins", svg).replaceChildren(anu, ...pins.map((p) => p.g));
  if (focused) svg.querySelector(`[data-store="${focused}"]`)?.focus();
  placeView();
  drawMapList(chosen);
}

// The list beside the map (wide screens): pressing one picks it, pointing at
// one lights its dot.
function drawMapList(chosen) {
  const live = stores.filter((s) => s.live).sort((a, b) => b.live - a.live || km(origin, a) - km(origin, b));
  $("#map-list").replaceChildren(
    ...live.map((s) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiet";
      b.dataset.store = s.id;
      b.setAttribute("aria-pressed", String(s.id === chosen));
      const name = document.createElement("span");
      name.textContent = s.name;
      const where = document.createElement("small");
      where.textContent = `${s.where} · ${km(origin, s).toFixed(1)} km`;
      const count = document.createElement("b");
      count.textContent = String(s.live);
      count.setAttribute("aria-label", `${s.live} live`);
      b.append(name, where, count);
      li.append(b);
      return li;
    }),
  );
  const rest = stores.length - live.length;
  $("#map-list-rest").textContent = live.length
    ? `${rest} other store${rest === 1 ? " has" : "s have"} nothing live right now.`
    : "Nothing is live at any store right now.";
}

$("#map-list").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) pickFromMap(b.dataset.store);
});
for (const [type, on] of [["pointerover", true], ["pointerout", false], ["focusin", true], ["focusout", false]]) {
  $("#map-list").addEventListener(type, (e) => {
    const b = e.target.closest("button");
    if (b) $(`#map-svg [data-store="${b.dataset.store}"]`)?.classList.toggle("lit", on);
  });
}

// Dots keep their size on screen, so when zoomed out stores a few doors apart
// would overlap: nudge them apart on screen (never ANU, which stays put).
function placePins() {
  const svg = $("#map-svg");
  const anu = $(".map-anu", svg);
  if (!anu) return;
  const screen = (p) => ({ x: (p.x - view.x) / view.u, y: (p.y - view.y) / view.u });
  const home = { ...screen(mapAt(ANU)), r: 9, fixed: true };
  anu.setAttribute("transform", `translate(${mapAt(ANU).x} ${mapAt(ANU).y}) scale(${view.u})`);
  const dots = pins.map((p) => ({ p, r: p.r, ...screen(p.at) }));
  for (let round = 0; round < 30; round++) {
    for (const a of [home, ...dots])
      for (const b of dots) {
        if (a === b) continue;
        const [dx, dy] = [b.x - a.x || 0.01, b.y - a.y];
        const gap = Math.hypot(dx, dy);
        const need = a.r + b.r + 1.5;
        if (gap >= need) continue;
        const push = (need - gap) / (a.fixed ? 1 : 2) / gap;
        if (!a.fixed) {
          a.x -= dx * push;
          a.y -= dy * push;
        }
        b.x += dx * push;
        b.y += dy * push;
      }
  }
  for (const d of dots) {
    const [x, y] = [view.x + d.x * view.u, view.y + d.y * view.u];
    d.p.g.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${view.u})`);
  }
}

function pickFromMap(id) {
  const filter = $("#store-filter");
  filter.value = filter.value === id ? "" : id;
  filter.dispatchEvent(new Event("change"));
}

// Pointers: one drags the map, two pinch it; a press that barely moved on a
// dot picks that store.
const mapPointers = new Map();
let press = null;
const local = (e) => {
  const r = $("#map-svg").getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

$("#map-svg").addEventListener("pointerdown", (e) => {
  if (!streets) return;
  try {
    $("#map-svg").setPointerCapture(e.pointerId);
  } catch {
    // a pointer the browser no longer tracks: the drag just ends at the frame's edge
  }
  mapPointers.set(e.pointerId, local(e));
  press = mapPointers.size === 1 ? { ...local(e), store: e.target.closest(".map-store")?.dataset.store, moved: false } : null;
});

$("#map-svg").addEventListener("pointermove", (e) => {
  if (!mapPointers.has(e.pointerId)) return;
  const before = [...mapPointers.values()];
  const now = local(e);
  if (press && Math.hypot(now.x - press.x, now.y - press.y) > 6) press.moved = true;
  if (mapPointers.size === 1) {
    const last = mapPointers.get(e.pointerId);
    view.x -= (now.x - last.x) * view.u;
    view.y -= (now.y - last.y) * view.u;
    mapPointers.set(e.pointerId, now);
    $("#map-svg").classList.add("dragging");
    return placeView();
  }
  mapPointers.set(e.pointerId, now);
  const after = [...mapPointers.values()];
  const mid = (ps) => ({ x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 });
  const dist = (ps) => Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
  const [m0, m1] = [mid(before), mid(after)];
  view.x -= (m1.x - m0.x) * view.u;
  view.y -= (m1.y - m0.y) * view.u;
  zoomAt(m1.x, m1.y, dist(after) / dist(before));
});

function endPointer(e) {
  if (!mapPointers.delete(e.pointerId)) return;
  $("#map-svg").classList.remove("dragging");
  if (e.type === "pointerup" && press && !press.moved && press.store) pickFromMap(press.store);
  press = null;
}
$("#map-svg").addEventListener("pointerup", endPointer);
$("#map-svg").addEventListener("pointercancel", endPointer);

$("#map-svg").addEventListener(
  "wheel",
  (e) => {
    if (!streets) return;
    e.preventDefault();
    const { x, y } = local(e);
    zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)));
  },
  { passive: false },
);
$("#map-svg").addEventListener("dblclick", (e) => {
  const { x, y } = local(e);
  zoomAt(x, y, 2);
});

const zoomCentre = (factor) => {
  const svg = $("#map-svg");
  zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, factor);
};
$("#map-in").addEventListener("click", () => zoomCentre(1.6));
$("#map-out").addEventListener("click", () => zoomCentre(1 / 1.6));
$("#map-home").addEventListener("click", () => {
  fitStores();
  placeView();
});

// a screen reader's or keyboard's click on a dot (no pointer involved)
$("#map-svg").addEventListener("click", (e) => {
  const g = e.target.closest(".map-store");
  if (g && e.detail === 0) pickFromMap(g.dataset.store);
});
$("#map-svg").addEventListener("keydown", (e) => {
  const g = e.target.closest(".map-store");
  if (!g || (e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault();
  pickFromMap(g.dataset.store);
});
new ResizeObserver(() => placeView()).observe($("#map-svg"));

// counts come with the store list; it's fetched again only while the map is open
let mapRefresh = 0;
async function refreshMap() {
  if ($("#store-map").hidden) return;
  const fresh = await api("/api/stores").catch(() => null);
  if (!fresh) return;
  const live = new Map(fresh.map((s) => [s.id, s.live]));
  for (const s of stores) s.live = live.get(s.id) ?? 0;
  drawMap();
}
const refreshMapSoon = () => {
  clearTimeout(mapRefresh);
  mapRefresh = setTimeout(refreshMap, 1000);
};

// The map starts open; closing it is remembered on this device, and opening
// it again forgets that.
const MAP_CLOSED = "discountShow.mapClosed";
const mapWasClosed = () => {
  try {
    return localStorage.getItem(MAP_CLOSED) === "1";
  } catch {
    return false;
  }
};

function showMap(open, { remember = true } = {}) {
  $("#store-map").hidden = !open;
  $("#map-toggle").setAttribute("aria-expanded", String(open));
  if (remember) {
    try {
      if (open) localStorage.removeItem(MAP_CLOSED);
      else localStorage.setItem(MAP_CLOSED, "1");
    } catch {
      // private browsing: it opens again next time, which is the default anyway
    }
  }
  // drawn once the store list is in (startup draws it then)
  if (open && stores.length) {
    drawMap();
    refreshMap();
  }
}
$("#map-toggle").addEventListener("click", () => showMap($("#store-map").hidden));
$("#map-close").addEventListener("click", () => {
  showMap(false);
  $("#map-toggle").focus();
});
if (mapWasClosed()) showMap(false, { remember: false });

function onLive(ev) {
  if (ev.type !== "notice") refreshMapSoon();
  if (ev.type === "notice") loadNotices();
  else if (ev.type === "deleted") removeCard(ev.id);
  else if (ev.type === "new") newPostWaiting(ev.id);
  else if (ev.type === "deal") refreshDeal(ev.id);
}

// A new post on page one doesn't push the feed down under the reader: a pill
// says it's there, and the reader brings it in (whether it fits this store
// and search is still the server's call). Nothing is fetched until then.
let waiting = new Set();
const newPosts = $("#new-posts");

function newPostWaiting(id) {
  if (page !== 1 || deals.some((d) => d.id === id)) return; // elsewhere, or my own post, already shown
  waiting.add(id);
  showWaiting();
}

// My own post's "new" event can arrive before the server's answer to my post
// does (they come over different connections), when it still looks like
// someone else's; once the answer is here it isn't news to me.
function notWaiting(id) {
  if (waiting.delete(id)) showWaiting();
}

function showWaiting() {
  newPosts.textContent = waiting.size === 1 ? "↑ 1 new special" : `↑ ${waiting.size} new specials`;
  newPosts.hidden = !waiting.size;
}

function clearWaiting() {
  waiting = new Set();
  newPosts.hidden = true;
}

newPosts.addEventListener("click", async () => {
  const before = new Set(deals.map((d) => d.id));
  clearWaiting();
  $("#feed-layout").scrollIntoView({ block: "start", behavior: "smooth" });
  await loadFeed();
  for (const d of deals) if (!before.has(d.id)) glow(d.id, "landed");
});

// a card someone else just changed glows once, so the change is seen; a new
// one ("landed") drops into place first
function glow(id, cls = "updated") {
  const card = document.getElementById(`deal-${id}`);
  if (!card) return;
  card.classList.remove(cls);
  void card.offsetWidth; // restart the animation if it's still running
  card.classList.add(cls);
  setTimeout(() => card.classList.remove(cls), 2000);
}

// Every open page hears every event at once. A page that has to ask the server
// again waits a random moment first (and asks once however many events came),
// so a busy minute doesn't send every reader's request in the same instant.
const SPREAD_MS = 2000;
let reloadTimer = null;
function reloadSoon() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    loadFeed();
  }, Math.random() * SPREAD_MS);
}

function removeCard(id) {
  built.delete(id);
  const card = document.getElementById(`deal-${id}`);
  if (!card) return; // on another page
  card.remove();
  deals = deals.filter((x) => x.id !== id);
  reloadSoon(); // the next post moves up to fill the page, and the count drops
}

// Someone is mid-way through something on this card: don't pull it out from under them.
const busy = (card) =>
  card.contains(document.activeElement) ||
  !!card.querySelector(".delete-confirm:not([hidden])") ||
  [...card.querySelectorAll("details[open] input, details[open] textarea")].some((i) => i.value);

// A change to a post on this page: fetch it and swap its card. One on another
// page isn't fetched at all; it'll be current when that page is opened.
async function refreshDeal(id) {
  if (!document.getElementById(`deal-${id}`)) return;
  let d;
  try {
    d = await api(`/api/deals/${id}`);
  } catch (err) {
    if (err.status === 404) removeCard(id);
    return;
  }
  const card = document.getElementById(`deal-${id}`);
  if (!card) return; // gone from the page while it was fetched
  deals = deals.map((x) => (x.id === id ? d : x));
  if (busy(card)) return; // the data is kept; the card catches up on the next render
  if (card.classList.contains("sold-out") !== (d.stock === "gone")) {
    renderFeed(); // it moves
    return glow(id);
  }
  const commentsOpen = !!card.querySelector("details.comments")?.open;
  const next = cardFor(d, storeById().get(d.storeId), commentsOpen, !!card.querySelector("details.correct")?.open);
  card.replaceWith(next);
  // a like or a review doesn't change the post itself, so the card may be the
  // same one: open comments are read again either way
  if (commentsOpen && next === card) loadComments(id, next);
  glow(id);
}

// --- start

// The search and store row stays at the top while scrolling. It shows a
// shadow once actually stuck, and its height keeps the new-posts pill and
// page jumps clear of it.
const filters = $(".filters");
new IntersectionObserver(([e]) => filters.classList.toggle("stuck", !e.isIntersecting)).observe($("#filters-top"));
new ResizeObserver(() => document.documentElement.style.setProperty("--filters-h", `${filters.offsetHeight}px`)).observe(filters);

$("#store-filter").addEventListener("change", () => {
  if (!$("#store-map").hidden) drawMap();
  page = 1;
  syncAddress(false);
  loadFeed("swap");
});
// coming back to the tab picks up what others posted meanwhile
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  syncMe();
  loadFeed();
  loadNotices();
});

$("#search").value = new URLSearchParams(location.search).get("q") ?? "";
page = pageFromAddress();
me = await api("/api/me").catch(() => null);
showMe();
stores = await api("/api/stores");
renderStoreOptions();
if (!$("#store-map").hidden) drawMap();
await loadFeed();
loadNotices();
connectLive();

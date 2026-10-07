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
const STOCK_LEVEL = { gone: 0, few: 1, some: 2, plenty: 3 }; // cells of the bar filled

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
  return li;
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

  // How much is left, as a bar filled to the level (the card's data-stock
  // colours it). Someone logged in reports by pressing a level; a guest gets
  // the same bar read-only, with the level in words.
  const level = STOCK_LEVEL[d.stock];
  li.dataset.stock = d.stock;
  const group = $(".stock", li);
  const read = $(".stock-read", li);
  group.hidden = !me;
  read.hidden = !!me;
  group.setAttribute("aria-label", `How much ${d.item} is left`);
  for (const b of group.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.stock === d.stock));
    b.classList.toggle("filled", STOCK_LEVEL[b.dataset.stock] <= level && b.dataset.stock !== "gone");
    b.addEventListener("click", () => updateStock(d, b.dataset.stock));
  }
  read.querySelectorAll(".meter i").forEach((cell, n) => cell.classList.toggle("filled", n < level));
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

async function loadComments(id, li) {
  const list = $(".comment-list", li);
  try {
    const comments = await api(`/api/deals/${id}/comments`);
    list.replaceChildren(
      ...comments.map((c) => {
        const item = document.createElement("li");
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = `${nameOf(c.author)} · ${ago(c.createdAt)}`;
        const body = document.createElement("p");
        body.textContent = c.body;
        item.append(who, body);
        return item;
      }),
    );
  } catch (err) {
    list.textContent = `Couldn't load comments: ${err.message}`;
  }
}

async function postComment(e, id, li) {
  e.preventDefault();
  if (!requireLogin()) return;
  const input = e.target.elements.body;
  if (!input.value.trim()) return input.focus();
  try {
    await api(`/api/deals/${id}/comments`, { body: input.value });
    input.value = "";
    const d = deals.find((x) => x.id === id);
    if (d) d.comments += 1;
    $("details.comments summary", li).textContent = d?.comments === 1 ? "1 comment" : `${d?.comments ?? ""} comments`;
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
    clearPost();
    replaceOrAdd(deal);
    closeSimilar(`Posted “${deal.item}”.`);
    jumpTo(deal.id);
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

// --- the store map: each store where it is, its dot sized by live specials

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
// drawn at about a phone's width, so a dot is a finger's size there
const mapWidth = 360;
const mapPad = 30;

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function drawMap() {
  const svg = $("#map-svg");
  const all = [...stores, ANU];
  const lonScale = Math.cos((ANU.lat * Math.PI) / 180);
  const [minX, maxX] = [Math.min(...all.map((p) => p.lon)), Math.max(...all.map((p) => p.lon))];
  const [minY, maxY] = [Math.min(...all.map((p) => -p.lat)), Math.max(...all.map((p) => -p.lat))];
  const scale = (mapWidth - 2 * mapPad) / ((maxX - minX) * lonScale);
  const height = Math.round((maxY - minY) * scale + 2 * mapPad);
  const at = (p) => ({ x: mapPad + (p.lon - minX) * lonScale * scale, y: mapPad + (-p.lat - minY) * scale });
  svg.setAttribute("viewBox", `0 0 ${mapWidth} ${height}`);

  const areas = AREAS.map((a) => {
    const { x, y } = at(a);
    const half = a.name.length * 4.5;
    const t = svgEl("text", { x: Math.min(Math.max(x, half + 4), mapWidth - half - 4), y: Math.max(y, 14), class: "map-area", "text-anchor": "middle" });
    t.textContent = a.name;
    return t;
  });

  const anu = at(ANU);
  const home = svgEl("g", { class: "map-anu", transform: `translate(${anu.x} ${anu.y})` });
  const anuLabel = svgEl("text", { y: -10, "text-anchor": "middle" });
  anuLabel.textContent = "ANU";
  home.append(svgEl("rect", { x: -5, y: -5, width: 10, height: 10, rx: 2, transform: "rotate(45)" }), anuLabel);

  // stores a few doors apart would sit on top of each other: nudge them
  // apart, and off the ANU marker, which stays put
  const dots = stores.map((s) => ({ s, ...at(s), r: s.live ? 9 + 3 * Math.sqrt(s.live) : 5.5 }));
  const fixed = { ...anu, r: 8, fixed: true };
  for (let round = 0; round < 40; round++) {
    for (const a of [fixed, ...dots])
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
    for (const d of dots) {
      d.x = Math.min(Math.max(d.x, d.r + 2), mapWidth - d.r - 2);
      d.y = Math.min(Math.max(d.y, d.r + 2), height - d.r - 2);
    }
  }

  const chosen = $("#store-filter").value;
  // fullest drawn last, so it stays on top
  const marks = dots
    .sort((a, b) => a.s.live - b.s.live)
    .map(({ s, x, y, r }) => {
      const g = svgEl("g", {
        class: "map-store",
        transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`,
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
      g.append(tip, svgEl("circle", { r }));
      if (s.live) {
        const n = svgEl("text", { "text-anchor": "middle", dy: "0.35em" });
        n.textContent = String(s.live);
        g.append(n);
      }
      return g;
    });
  // redrawing mustn't lose the keyboard's place
  const focused = svg.contains(document.activeElement) && document.activeElement.dataset.store;
  svg.replaceChildren(...areas, home, ...marks);
  if (focused) svg.querySelector(`[data-store="${focused}"]`)?.focus();
}

function pickFromMap(id) {
  const filter = $("#store-filter");
  filter.value = filter.value === id ? "" : id;
  filter.dispatchEvent(new Event("change"));
}

$("#map-svg").addEventListener("click", (e) => {
  const g = e.target.closest(".map-store");
  if (g) pickFromMap(g.dataset.store);
});
$("#map-svg").addEventListener("keydown", (e) => {
  const g = e.target.closest(".map-store");
  if (!g || (e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault();
  pickFromMap(g.dataset.store);
});

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

function showMap(open) {
  $("#store-map").hidden = !open;
  $("#map-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    drawMap();
    refreshMap();
  }
}
$("#map-toggle").addEventListener("click", () => showMap($("#store-map").hidden));
$("#map-close").addEventListener("click", () => {
  showMap(false);
  $("#map-toggle").focus();
});

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
  newPosts.textContent = waiting.size === 1 ? "↑ 1 new special" : `↑ ${waiting.size} new specials`;
  newPosts.hidden = false;
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
  for (const d of deals) if (!before.has(d.id)) glow(d.id);
});

// a card someone else just changed glows once, so the change is seen
function glow(id) {
  const card = document.getElementById(`deal-${id}`);
  if (!card) return;
  card.classList.remove("updated");
  void card.offsetWidth; // restart the animation if it's still running
  card.classList.add("updated");
  card.addEventListener("animationend", () => card.classList.remove("updated"), { once: true });
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
  card.replaceWith(cardFor(
    d,
    storeById().get(d.storeId),
    !!card.querySelector("details.comments")?.open,
    !!card.querySelector("details.correct")?.open,
  ));
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
await loadFeed();
loadNotices();
connectLive();

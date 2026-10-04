// discountShow: the whole client. No framework, no build step.
//
// Identity is a random id plus a nickname, kept in this browser's
// localStorage and sent with every post. A location, if the visitor shares
// one, is only used here to sort stores; it is never sent to the server.

const ANU = { lat: -35.2777, lon: 149.1185 };
const ME_KEY = "specials.me";

const $ = (sel, root = document) => root.querySelector(sel);

// --- who am I

function loadMe() {
  try {
    const saved = JSON.parse(localStorage.getItem(ME_KEY) ?? "null");
    if (saved && typeof saved.id === "string") return saved;
  } catch {
    // storage blocked or corrupt: start fresh
  }
  return { id: crypto.randomUUID(), name: "" };
}

const me = loadMe();

function saveMe() {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify(me));
  } catch {
    // private window: the identity lasts as long as the tab
  }
}

// Two people can pick the same nickname, so every name is shown with the
// last four characters of its id.
const tagOf = (author) => `#${author.id.slice(-4)}`;
const nameOf = (author) => `${author.name} ${tagOf(author)}`;

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
const endsText = (endsOn) => {
  if (!endsOn) return "no end date given";
  if (endsOn === ymd(new Date())) return "ends today";
  return `ends ${dayFmt.format(new Date(`${endsOn}T12:00:00`))}`;
};

const SOURCE_TEXT = {
  "in-store": "seen in store",
  "store-website": "from the store's site",
  catalogue: "from the catalogue",
  "word-of-mouth": "word of mouth",
};

const STOCK_TEXT = { plenty: "plenty", some: "some", few: "only a few", gone: "sold out" };

// --- api

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data;
}

// --- stores, sorted by distance from ANU or from the visitor

let stores = [];
let origin = ANU;

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

// --- the feed

let deals = [];

async function loadFeed() {
  const store = $("#store-filter").value;
  try {
    deals = await api(`/api/deals${store ? `?store=${encodeURIComponent(store)}` : ""}`);
    renderFeed();
  } catch (err) {
    $("#feed-status").textContent = `Couldn't load specials: ${err.message}`;
  }
}

function renderFeed() {
  const byId = new Map(stores.map((s) => [s.id, s]));
  const open = new Set([...document.querySelectorAll("#feed details[open]")].map((d) => d.closest("li").dataset.id));
  $("#feed").replaceChildren(...deals.map((d) => dealCard(d, byId.get(d.storeId), open.has(String(d.id)))));
  const store = byId.get($("#store-filter").value);
  $("#feed-status").textContent = deals.length
    ? ""
    : `Nothing posted${store ? ` for ${store.name}, ${store.where}` : ""} yet. Spotted a special? Be the first.`;
}

function dealCard(d, store, open) {
  const li = $("#deal-template").content.firstElementChild.cloneNode(true);
  li.dataset.id = d.id;
  li.classList.toggle("sold-out", d.stock === "gone");
  $(".item", li).textContent = d.item;
  $(".store", li).textContent = store ? `${store.name}, ${store.where} · ${km(origin, store).toFixed(1)} km` : d.storeId;
  $(".now", li).textContent = money(d.nowCents);
  $(".was", li).textContent = money(d.wasCents);
  $(".off", li).textContent = `${Math.round((1 - d.nowCents / d.wasCents) * 100)}% off`;
  $(".meta", li).textContent = `${SOURCE_TEXT[d.source]} · ${endsText(d.endsOn)} · posted by ${nameOf(d.author)}, ${ago(d.createdAt)}`;

  const group = $(".stock", li);
  group.setAttribute("aria-label", `How much ${d.item} is left`);
  for (const b of group.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.stock === d.stock));
    b.addEventListener("click", () => updateStock(d, b.dataset.stock));
  }
  $(".stock-by", li).textContent = `${STOCK_TEXT[d.stock]}, according to ${nameOf(d.stockBy)}, ${ago(d.stockAt)}`;

  const details = $("details", li);
  $("summary", li).textContent = d.comments === 1 ? "1 comment" : `${d.comments} comments`;
  details.addEventListener("toggle", () => details.open && loadComments(d.id, li));
  $(".comment-form", li).addEventListener("submit", (e) => postComment(e, d.id, li));
  if (open) details.open = true;
  return li;
}

async function updateStock(d, stock) {
  if (!requireName()) return;
  try {
    const updated = await api(`/api/deals/${d.id}/stock`, { stock, author: me });
    deals = deals.map((x) => (x.id === updated.id ? updated : x));
    renderFeed();
  } catch (err) {
    $("#feed-status").textContent = err.message;
  }
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
  if (!requireName()) return;
  const input = e.target.elements.body;
  if (!input.value.trim()) return input.focus();
  try {
    await api(`/api/deals/${id}/comments`, { body: input.value, author: me });
    input.value = "";
    const d = deals.find((x) => x.id === id);
    if (d) d.comments += 1;
    $("summary", li).textContent = d?.comments === 1 ? "1 comment" : `${d?.comments ?? ""} comments`;
    loadComments(id, li);
  } catch (err) {
    alertIn(li, err.message);
  }
}

function alertIn(li, message) {
  let p = $(".error", li);
  if (!p) {
    p = document.createElement("p");
    p.className = "error";
    p.setAttribute("role", "alert");
    li.append(p);
  }
  p.textContent = message;
}

// --- nickname

const nickname = $("#nickname");

function showMe() {
  nickname.value = me.name;
  $("#me-tag").textContent = me.name ? tagOf(me) : "";
}

nickname.addEventListener("change", () => {
  me.name = nickname.value.trim().slice(0, 24);
  saveMe();
  showMe();
});

function requireName() {
  if (me.name) return true;
  nickname.focus();
  nickname.setAttribute("aria-invalid", "true");
  $("#feed-status").textContent = "Pick a nickname first, so others know who's reporting.";
  return false;
}

// --- posting a special

const post = $("#post");

const toCents = (s) => {
  const t = s.trim().replace(/^\$/, "");
  return /^\d{1,4}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
};

$("#next-tuesday").addEventListener("click", () => {
  const d = new Date();
  d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7));
  post.elements.endsOn.value = ymd(d);
});

post.elements.endsOn.min = ymd(new Date());

post.addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#post-error");
  error.textContent = "";
  if (!requireName()) {
    error.textContent = "Pick a nickname first (top of the page).";
    return;
  }
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
  if (problem) {
    error.textContent = problem;
    return;
  }
  try {
    const deal = await api("/api/deals", {
      storeId: f.storeId.value,
      item: f.product.value,
      wasCents,
      nowCents,
      endsOn: f.endsOn.value || null,
      stock: f.stock.value,
      source: f.source.value,
      author: me,
    });
    for (const name of ["product", "was", "now", "endsOn"]) f[name].value = "";
    const filter = $("#store-filter").value;
    if (!filter || filter === deal.storeId) deals = [deal, ...deals];
    renderFeed();
  } catch (err) {
    error.textContent = err.message;
  }
});

// --- start

$("#store-filter").addEventListener("change", loadFeed);
nickname.addEventListener("input", () => nickname.removeAttribute("aria-invalid"));
// coming back to the tab picks up what others posted meanwhile
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && loadFeed());

saveMe();
showMe();
stores = await api("/api/stores");
renderStoreOptions();
await loadFeed();

// The login page, /login: log in or create an account, then go back to the
// page that sent you here (?next=). ?why= says what you were trying to do.
// Like app.js, it never sees the session: the server sets an HttpOnly cookie.

const $ = (sel) => document.querySelector(sel);

// Only this site's own pages, so a link to /login can't be used to send
// someone somewhere else after they type their password. Anything else is "/".
const PAGE = /^\/(?:stores(?:\/[a-z0-9-]{1,60})?|deals\/\d{1,9})?$/;

function safeNext(raw) {
  if (!raw || raw.length > 300 || !raw.startsWith("/") || raw.startsWith("//") || /[\\\0-\x20\x7f]/.test(raw)) return "/";
  const url = new URL(raw, location.origin);
  return url.origin === location.origin && PAGE.test(url.pathname) ? url.pathname + url.search : "/";
}

const params = new URLSearchParams(location.search);
const next = safeNext(params.get("next"));
$("#login-back").href = next;
$("#login-continue").href = next;

// fixed sentences: what's in ?why= only picks one, it is never shown
const WHY = {
  post: "Log in or create an account to post a special. Reading stays free.",
  comment: "Log in or create an account to comment. Reading stays free.",
};
if (Object.hasOwn(WHY, params.get("why") ?? "")) $("#login-why").textContent = WHY[params.get("why")];

const form = $("#login-form");
const error = $("#login-error");
const submit = $("#login-submit");
let registering = false;

// one form for both: the switch under it changes what it does
function showMode() {
  const title = registering ? "Create an account" : "Log in";
  $("#login-title").textContent = title;
  document.title = `${title} · discountShow`;
  submit.textContent = registering ? "Create account" : "Log in";
  $("#login-switch").textContent = registering ? "Have an account? Log in" : "New here? Create an account";
  form.elements.password.autocomplete = registering ? "new-password" : "current-password";
  $("#login-rules").hidden = !registering;
  error.textContent = "";
}

$("#login-switch").addEventListener("click", () => {
  registering = !registering;
  showMode();
  form.elements.username.focus();
});

const sentence = (s) => `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}`;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  submit.textContent = registering ? "Creating account…" : "Logging in…";
  let res;
  try {
    res = await fetch(registering ? "/api/register" : "/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value }),
    });
  } catch {
    res = null;
  }
  const data = res ? await res.json().catch(() => ({})) : {};
  if (res?.ok) return location.replace(next); // so Back skips this page
  submit.disabled = false;
  showMode();
  if (!res) {
    error.textContent = "Couldn't reach discountShow. Check your connection and try again.";
    return;
  }
  error.textContent = sentence(data.error ?? `Something went wrong (${res.status})`);
  if (res.status === 401) form.elements.password.value = "";
  const field = res.status === 409 || /^username/.test(data.error ?? "") ? "username" : "password";
  form.elements[field].focus();
});

// Already logged in (say, from another tab): say as whom, rather than ask again.
function showSignedIn(me) {
  form.hidden = !!me;
  $("#login-why").hidden = !!me;
  $("#login-signed-in").hidden = !me;
  if (me) {
    $("#login-name").textContent = me.name;
    $("#login-title").textContent = "You're logged in";
    document.title = "Logged in · discountShow";
  } else {
    showMode();
    form.elements.username.focus();
  }
}

$("#login-logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  showSignedIn(null);
});

const me = await fetch("/api/me").then((r) => r.json()).catch(() => null);
showSignedIn(me);
$("main").setAttribute("aria-busy", "false");

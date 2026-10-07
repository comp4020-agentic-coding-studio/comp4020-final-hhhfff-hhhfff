// Applies the visitor's chosen colours (light or dark) before the page
// paints; with no choice, the system decides. A classic script, loaded in the
// head on purpose: app.js runs too late to avoid a flash of the wrong theme.
try {
  const theme = localStorage.getItem("discountShow.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // storage blocked: follow the system
}

// Set the `dark` class on <html> BEFORE first paint, mirroring the logic in
// src/lib/use-theme.tsx. Without this, a dark-mode user sees a light flash
// because React's useEffect runs after the browser has already painted.
// Keep STORAGE_KEY in sync with use-theme.tsx.
//
// This lives in /app/public/ instead of inline in /app/index.html so the
// site CSP can use `script-src 'self'` without `'unsafe-inline'`.
(function () {
  try {
    var pref = localStorage.getItem("scout-app-theme");
    if (pref !== "light" && pref !== "dark" && pref !== "system") {
      pref = "system";
    }
    var resolved =
      pref === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : pref;
    if (resolved === "dark") {
      document.documentElement.classList.add("dark");
    }
  } catch (_err) {
    // localStorage / matchMedia unavailable — fall through to light.
  }
})();

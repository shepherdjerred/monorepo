import { z } from "zod";
import { resolveTheme, themeCatalog, ThemeIdSchema } from "./catalog.ts";
import {
  defaultPreferences,
  localPreferenceCookie,
  PreferencesSchema,
  readPreferences,
  preferenceCookie,
  type StormPreferences,
} from "./preferences.ts";
import { applySurface, renderEffects, syncControls } from "./surface.ts";
import { startViewer } from "./viewer.ts";

const StateSchema = z.object({ themeId: ThemeIdSchema, revision: z.string() });
const ResponseSchema = z.object({
  preferences: PreferencesSchema,
  csrf: z.string().min(1),
});

export async function startStormTheme(root: HTMLElement): Promise<void> {
  const sync = z
    .enum(["forum", "local"])
    .parse(root.dataset["stormSync"] ?? "forum");
  const docs = root.dataset["stormSurface"] === "docs";
  const apiValue = root.dataset["stormApi"],
    baseValue = root.dataset["stormBase"];
  if (
    baseValue === undefined ||
    baseValue === "" ||
    (sync === "local" && !docs) ||
    (sync === "forum" && (apiValue === undefined || apiValue === ""))
  )
    throw new Error("Storm theme bootstrap is incomplete");
  const api =
      sync === "forum"
        ? new URL(z.string().min(1).parse(apiValue), location.href)
        : undefined,
    assetBase = new URL(baseValue, location.href);
  if (docs && api) startViewer(root, api);
  const media = matchMedia("(prefers-color-scheme: dark)"),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const cookieName =
    sync === "local" ? localPreferenceCookie : preferenceCookie;
  let preferences = readPreferences(document.cookie, cookieName) ?? {
    ...defaultPreferences,
  };
  let publicTheme = resolveTheme("auto", true, new Date()),
    csrf = "";
  const layer = document.createElement("div");
  layer.className = "stormEffects";
  layer.setAttribute("aria-hidden", "true");
  document.body.prepend(layer);
  const status = root.querySelector<HTMLElement>("[data-storm-status]");

  function apply() {
    const mode =
      preferences.appearance === "system"
        ? media.matches
          ? "dark"
          : "light"
        : preferences.appearance;
    const id = preferences.theme === "auto" ? publicTheme : preferences.theme;
    const theme = themeCatalog.themes.find((candidate) => candidate.id === id);
    if (!theme) throw new Error("Unknown Storm theme");
    document.documentElement.dataset["stormAppearance"] =
      preferences.appearance;
    applySurface(theme, mode, docs, assetBase);
    renderEffects(layer, theme, {
      enabled: preferences.effects,
      reduced: reduced.matches,
    });
    syncControls(root, preferences);
  }
  async function request(url: URL, options?: RequestInit): Promise<unknown> {
    const response = await fetch(url, { credentials: "include", ...options });
    if (!response.ok)
      throw new Error(`Theme request failed: ${String(response.status)}`);
    return response.json();
  }
  async function refresh() {
    if (!api) {
      publicTheme = resolveTheme("auto", true, new Date());
      apply();
      return;
    }
    const endpoint = new URL(api.href.replace(/\/?$/, "/") + "preferences");
    const [state, saved] = await Promise.all([
      request(api).then((value) => StateSchema.parse(value)),
      request(endpoint).then((value) => ResponseSchema.parse(value)),
    ]);
    publicTheme = state.themeId;
    preferences = saved.preferences;
    csrf = saved.csrf;
    apply();
    if (status) status.textContent = "";
  }
  async function save(next: StormPreferences) {
    if (!api) {
      document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify(next))}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      preferences = next;
      apply();
      if (status) status.textContent = "Saved.";
      return;
    }
    if (!csrf) await refresh();
    const body = new URLSearchParams({
      storm_mode: next.appearance,
      storm_theme: next.theme,
      storm_effects: next.effects ? "1" : "0",
      t: csrf,
      _xfToken: csrf,
    });
    const saved = ResponseSchema.parse(
      await request(new URL(api.href.replace(/\/?$/, "/") + "preferences"), {
        method: "POST",
        body,
      }),
    );
    preferences = saved.preferences;
    csrf = saved.csrf;
    apply();
    if (status) status.textContent = "Saved.";
  }
  function error(value: unknown) {
    if (status)
      status.textContent = "Couldn't sync theme preferences. Please try again.";
    console.error(
      "Storm theme synchronization failed",
      value instanceof Error ? value.message : "Unknown response",
    );
  }
  async function submit(form: HTMLFormElement) {
    const fields = new FormData(form);
    const next = PreferencesSchema.parse({
      version: 1,
      appearance: fields.get("storm_mode"),
      theme: fields.get("storm_theme"),
      effects: fields.has("storm_effects"),
    });
    const button = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (button) button.disabled = true;
    form.setAttribute("aria-busy", "true");
    if (status) status.textContent = "Saving…";
    try {
      await save(next);
    } finally {
      if (button) button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  }
  async function run(operation: () => Promise<void>) {
    try {
      await operation();
    } catch (error_) {
      error(error_);
    }
  }
  root
    .querySelectorAll<HTMLFormElement>("[data-storm-preferences]")
    .forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void run(() => submit(form));
      });
    });
  media.addEventListener("change", () => {
    if (preferences.appearance === "system") apply();
  });
  reduced.addEventListener("change", apply);
  document.addEventListener("visibilitychange", () => {
    layer.style.animationPlayState = document.hidden ? "paused" : "running";
    if (!document.hidden) void run(refresh);
  });
  document.addEventListener("xf:variation-change", () => {
    void run(refresh);
  });
  apply();
  await refresh();
}

const root = document.querySelector("#storm-theme-root");
if (root instanceof HTMLElement) {
  try {
    await startStormTheme(root);
  } catch (error) {
    console.error(
      "Storm theme initialization failed",
      error instanceof Error ? error.message : "Unknown response",
    );
  }
}

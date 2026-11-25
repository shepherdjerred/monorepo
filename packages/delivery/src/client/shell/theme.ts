import {
  createThemeStore,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui";

export const DELIVERY_THEME_KEY = "delivery-theme";

function noop(): void {
  // SSR / headless router test fallback.
}

function deliveryThemeEnvironment(): ThemeEnvironment {
  if (
    typeof document === "undefined" ||
    typeof globalThis.matchMedia !== "function"
  ) {
    const dataset: DOMStringMap = {};
    return {
      storage: () => ({
        getItem: () => null,
        setItem: noop,
        removeItem: noop,
      }),
      darkQuery: {
        matches: false,
        addEventListener: noop,
      },
      root: { dataset },
      onStorage: noop,
    };
  }
  return {
    storage: () => globalThis.localStorage,
    darkQuery: globalThis.matchMedia("(prefers-color-scheme: dark)"),
    root: document.documentElement,
    onStorage: (listener) => {
      globalThis.addEventListener("storage", (event) => {
        if (event instanceof StorageEvent) listener(event.key, event.newValue);
      });
    },
  };
}

/**
 * Delivery's theme preference (`system` | `light` | `dark`), persisted under
 * `delivery-theme` and reflected onto `html[data-theme]`.
 */
export const deliveryTheme = createThemeStore(
  DELIVERY_THEME_KEY,
  deliveryThemeEnvironment(),
);

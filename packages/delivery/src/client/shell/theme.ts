import {
  createThemeStore,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui";

export const DELIVERY_THEME_KEY = "delivery-theme";

function noop(): void {
  // SSR / headless router test fallback.
}

function headlessThemeEnvironment(): ThemeEnvironment | undefined {
  if (
    typeof document !== "undefined" &&
    typeof globalThis.matchMedia === "function"
  ) {
    return undefined;
  }
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

const headlessEnvironment = headlessThemeEnvironment();

/**
 * Delivery's theme preference (`system` | `light` | `dark`), persisted under
 * `delivery-theme` and reflected onto `html[data-theme]`.
 */
export const deliveryTheme =
  headlessEnvironment === undefined
    ? createThemeStore(DELIVERY_THEME_KEY)
    : createThemeStore(DELIVERY_THEME_KEY, headlessEnvironment);

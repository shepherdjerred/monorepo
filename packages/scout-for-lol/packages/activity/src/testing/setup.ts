import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div><div id="activity-overlay-root"></div></body></html>',
  { url: "https://customs-beta.scout-for-lol.com", pretendToBeVisual: true },
);

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Element: { value: dom.window.Element, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  getComputedStyle: { value: dom.window.getComputedStyle, configurable: true },
  requestAnimationFrame: {
    value: dom.window.requestAnimationFrame.bind(dom.window),
    configurable: true,
  },
  cancelAnimationFrame: {
    value: dom.window.cancelAnimationFrame.bind(dom.window),
    configurable: true,
  },
  IS_REACT_ACT_ENVIRONMENT: {
    value: true,
    configurable: true,
    writable: true,
  },
});

Object.defineProperty(dom.window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {
      return;
    },
    removeListener: () => {
      return;
    },
    addEventListener: () => {
      return;
    },
    removeEventListener: () => {
      return;
    },
    dispatchEvent: () => false,
  }),
});

class TestResizeObserver {
  observe(): void {
    return;
  }
  unobserve(): void {
    return;
  }
  disconnect(): void {
    return;
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: TestResizeObserver,
  configurable: true,
});
Object.defineProperty(dom.window.Element.prototype, "scrollIntoView", {
  value: () => {
    return;
  },
  configurable: true,
});

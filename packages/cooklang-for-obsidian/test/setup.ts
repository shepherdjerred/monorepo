/** Test preload: registers happy-dom for a real DOM, then polyfills the small
 *  subset of Obsidian's HTMLElement augmentation (createEl/createDiv/createSpan/
 *  empty/addClass/toggleClass/setAttr) that the renderer relies on. Obsidian
 *  installs these on HTMLElement.prototype at runtime; we mirror that here so
 *  renderRecipe runs against genuine HTMLElement instances with no type casts. */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

type DomElementInfo = {
  cls?: string | string[];
  text?: string | DocumentFragment;
  href?: string;
  attr?: Record<string, string | number | boolean | null>;
};

function applyInfo(el: HTMLElement, info?: DomElementInfo | string): void {
  if (info === undefined) return;
  if (typeof info === "string") {
    el.className = info;
    return;
  }
  if (info.cls !== undefined) {
    const classes = Array.isArray(info.cls) ? info.cls : [info.cls];
    el.classList.add(...classes);
  }
  if (info.text !== undefined && typeof info.text === "string") {
    el.textContent = info.text;
  }
  if (info.href !== undefined) {
    el.setAttribute("href", info.href);
  }
  if (info.attr !== undefined) {
    for (const [key, value] of Object.entries(info.attr)) {
      if (value !== null) el.setAttribute(key, String(value));
    }
  }
}

HTMLElement.prototype.createEl = function createEl<
  K extends keyof HTMLElementTagNameMap,
>(
  this: HTMLElement,
  tag: K,
  info?: DomElementInfo | string,
  callback?: (el: HTMLElementTagNameMap[K]) => void,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyInfo(el, info);
  this.append(el);
  if (callback) callback(el);
  return el;
};

HTMLElement.prototype.createDiv = function createDiv(
  this: HTMLElement,
  info?: DomElementInfo | string,
  callback?: (el: HTMLDivElement) => void,
): HTMLDivElement {
  return this.createEl("div", info, callback);
};

HTMLElement.prototype.createSpan = function createSpan(
  this: HTMLElement,
  info?: DomElementInfo | string,
  callback?: (el: HTMLSpanElement) => void,
): HTMLSpanElement {
  return this.createEl("span", info, callback);
};

HTMLElement.prototype.empty = function empty(this: HTMLElement): void {
  this.replaceChildren();
};

HTMLElement.prototype.addClass = function addClass(
  this: HTMLElement,
  ...classes: string[]
): void {
  this.classList.add(...classes);
};

HTMLElement.prototype.toggleClass = function toggleClass(
  this: HTMLElement,
  classes: string | string[],
  value: boolean,
): void {
  const list = Array.isArray(classes) ? classes : [classes];
  for (const cls of list) this.classList.toggle(cls, value);
};

HTMLElement.prototype.setAttr = function setAttr(
  this: HTMLElement,
  qualifiedName: string,
  value: string | number | boolean | null,
): void {
  if (value === null) this.removeAttribute(qualifiedName);
  else this.setAttribute(qualifiedName, String(value));
};

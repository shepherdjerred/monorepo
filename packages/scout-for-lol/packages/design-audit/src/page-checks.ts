import { expect, type Page } from "@playwright/test";

export function evaluateBrowser<T>(page: Page, callback: () => T): Promise<T> {
  return page.evaluate(callback);
}

export async function waitForStablePage(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(250);
  await expect(
    page.locator("a, button, h1, h2").first(),
    "page must render visible content",
  ).toBeVisible();
  await expect(
    page.getByText("Loading…", { exact: true }),
    "page must finish its initial loading state",
  ).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [...document.images];
    for (const image of images) image.loading = "eager";
    await Promise.all(
      images.map(async (image) => {
        if (!image.complete) {
          await new Promise<void>((resolve) => {
            image.addEventListener(
              "load",
              () => {
                resolve();
              },
              { once: true },
            );
            image.addEventListener(
              "error",
              () => {
                resolve();
              },
              { once: true },
            );
          });
        }
        try {
          await image.decode();
        } catch {
          void 0;
        }
      }),
    );
  });
  const brokenImages = await page
    .locator("img")
    .evaluateAll((images) =>
      images
        .filter(
          (image) =>
            image instanceof HTMLImageElement &&
            image.getAttribute("src") !== null &&
            image.getAttribute("src") !== "" &&
            image.naturalWidth === 0,
        )
        .map((image) => image.getAttribute("src") ?? "<missing src>"),
    );
  expect(brokenImages, "images must load successfully").toEqual([]);
  const stuckLoading = await page
    .locator('[aria-busy="true"], [data-loading="true"]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        })
        .map((element) => element.tagName.toLowerCase()),
    );
  expect(stuckLoading, "page must not remain in a loading state").toEqual([]);
}

export async function assertLayoutHealth(page: Page): Promise<void> {
  const findings = await page.evaluate(() => {
    const visible = (element: HTMLElement): boolean => {
      const style = getComputedStyle(element);
      const rectangle = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        element.closest('[aria-hidden="true"]') === null &&
        rectangle.width > 0 &&
        rectangle.height > 0
      );
    };
    const allowed = (element: Element, attribute: string): boolean =>
      element.closest(`[${attribute}]`) !== null;
    const isScrollable = (element: Element, axis: "x" | "y"): boolean => {
      const style = getComputedStyle(element);
      const overflow = axis === "x" ? style.overflowX : style.overflowY;
      const scrollSize =
        axis === "x" ? element.scrollWidth : element.scrollHeight;
      const clientSize =
        axis === "x" ? element.clientWidth : element.clientHeight;
      return (
        (overflow === "auto" || overflow === "scroll") &&
        scrollSize > clientSize + 1
      );
    };
    const hasScrollableAncestor = (element: Element): boolean =>
      element.parentElement !== null &&
      (isScrollable(element.parentElement, "x") ||
        isScrollable(element.parentElement, "y") ||
        hasScrollableAncestor(element.parentElement));
    const isClipping = (
      overflow: string,
      scrollable: boolean,
      outside: boolean,
    ): boolean =>
      outside &&
      (["hidden", "clip"].includes(overflow) ||
        (["auto", "scroll"].includes(overflow) && !scrollable));
    const hasClippingAncestor = (
      element: HTMLElement,
      rectangle: DOMRect,
    ): boolean => {
      if (allowed(element, "data-design-audit-allow-overflow")) return false;
      let current = element.parentElement;
      while (current !== null) {
        const style = getComputedStyle(current);
        const ancestor = current.getBoundingClientRect();
        const outsideX =
          rectangle.left < ancestor.left - 1 ||
          rectangle.right > ancestor.right + 1;
        const outsideY =
          rectangle.top < ancestor.top - 1 ||
          rectangle.bottom > ancestor.bottom + 1;
        if (
          isClipping(style.overflowX, isScrollable(current, "x"), outsideX) ||
          isClipping(style.overflowY, isScrollable(current, "y"), outsideY)
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    };
    const hasDirectText = (element: Element): boolean =>
      [...element.childNodes].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE &&
          (node.textContent ?? "").trim() !== "",
      );
    const isClipped = (element: HTMLElement, rectangle: DOMRect): boolean =>
      !allowed(element, "data-design-audit-allow-overflow") &&
      element.closest(".right-sidebar") === null &&
      // Monaco virtualizes its line layer inside an intentional clip region.
      element.closest(".monaco-editor") === null &&
      !hasScrollableAncestor(element) &&
      (hasClippingAncestor(element, rectangle) ||
        (rectangle.right > window.innerWidth + 1 &&
          rectangle.width < window.innerWidth));
    const isTruncated = (
      element: HTMLElement,
      style: CSSStyleDeclaration,
    ): boolean =>
      hasDirectText(element) &&
      !element.matches(".sr-only, .scout-sr-only") &&
      element.tagName !== "SPAN" &&
      style.overflow === "hidden" &&
      style.whiteSpace === "nowrap" &&
      style.textOverflow !== "ellipsis" &&
      (element.scrollHeight > element.clientHeight + 1 ||
        element.scrollWidth > element.clientWidth + 1) &&
      !allowed(element, "data-design-audit-allow-truncation");
    const isSmallControl = (
      element: HTMLElement,
      rectangle: DOMRect,
    ): boolean =>
      element.matches(
        "button, a.scout-button, input, select, textarea, [role=button]",
      ) &&
      !element.matches('select[aria-hidden="true"]') &&
      (rectangle.width < 24 || rectangle.height < 24) &&
      !allowed(element, "data-design-audit-allow-small-target");
    const elements = [...document.querySelectorAll<HTMLElement>("*")].filter(
      (element) => visible(element),
    );
    const isIntentionalRightSidebar = (element: HTMLElement): boolean =>
      element.closest(".right-sidebar") !== null;
    const clipped: string[] = [];
    const truncated: string[] = [];
    const smallControls: string[] = [];
    const horizontalOverflow =
      document.documentElement.scrollWidth > window.innerWidth + 1 &&
      [...document.querySelectorAll<HTMLElement>("*")].some((element) => {
        if (!visible(element) || isIntentionalRightSidebar(element)) {
          return false;
        }
        const rectangle = element.getBoundingClientRect();
        return rectangle.left < -1 || rectangle.right > window.innerWidth + 1;
      });

    for (const element of elements) {
      const rectangle = element.getBoundingClientRect();
      if (isClipped(element, rectangle)) {
        clipped.push(element.tagName.toLowerCase());
      }
      const style = getComputedStyle(element);
      if (isTruncated(element, style)) {
        truncated.push(element.tagName.toLowerCase());
      }
      if (isSmallControl(element, rectangle)) {
        smallControls.push(element.tagName.toLowerCase());
      }
    }

    return { horizontalOverflow, clipped, truncated, smallControls };
  });

  expect(findings.horizontalOverflow, "unexpected horizontal overflow").toBe(
    false,
  );
  expect(
    findings.clipped,
    "visible elements are clipped by the viewport",
  ).toEqual([]);
  expect(
    findings.truncated,
    "visible text is truncated without an explicit allowance",
  ).toEqual([]);
  expect(
    findings.smallControls,
    "interactive targets are smaller than 24px",
  ).toEqual([]);
}

export async function assertRenderedContrast(page: Page): Promise<void> {
  const issues = await page.evaluate(() => {
    type Color = [number, number, number, number];
    const color = (value: string): Color | null => {
      const parseComponents = (
        componentSource: string,
        normalized: boolean,
      ): Color | null => {
        const components = componentSource
          .replaceAll("/", " ")
          .split(/[\s,]+/)
          .filter((component) => component.length > 0);
        if (components.length < 3) return null;
        const channel = (component: string): number => {
          if (component.endsWith("%")) {
            return (Number.parseFloat(component) / 100) * 255;
          }
          const parsed = Number.parseFloat(component);
          return normalized ? parsed * 255 : parsed;
        };
        const red = channel(components[0] ?? "");
        const green = channel(components[1] ?? "");
        const blue = channel(components[2] ?? "");
        const alphaValue = components[3] ?? "1";
        const alpha = alphaValue.endsWith("%")
          ? Number.parseFloat(alphaValue) / 100
          : Number.parseFloat(alphaValue);
        if (
          [red, green, blue, alpha].some((component) => Number.isNaN(component))
        ) {
          return null;
        }
        return [red, green, blue, alpha];
      };
      const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
      if (rgba !== null) {
        return parseComponents(rgba[1] ?? "", false);
      }
      const srgb = /^color\(srgb ([^)]*)\)$/.exec(value);
      if (srgb !== null) {
        return parseComponents(srgb[1] ?? "", true);
      }
      const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
      const digits = hex?.[1];
      if (digits === undefined) return null;
      return [
        Number.parseInt(digits.slice(0, 2), 16),
        Number.parseInt(digits.slice(2, 4), 16),
        Number.parseInt(digits.slice(4, 6), 16),
        hex?.[2] === undefined ? 1 : Number.parseInt(hex[2], 16) / 255,
      ];
    };
    const luminance = (value: number): number => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const ratio = (foreground: Color, background: Color): number => {
      const foregroundLuminance =
        0.2126 * luminance(foreground[0]) +
        0.7152 * luminance(foreground[1]) +
        0.0722 * luminance(foreground[2]);
      const backgroundLuminance =
        0.2126 * luminance(background[0]) +
        0.7152 * luminance(background[1]) +
        0.0722 * luminance(background[2]);
      const high = Math.max(foregroundLuminance, backgroundLuminance);
      const low = Math.min(foregroundLuminance, backgroundLuminance);
      return (high + 0.05) / (low + 0.05);
    };
    const blend = (
      background: Color,
      foreground: Color,
      alpha: number,
    ): Color => {
      const clampedAlpha = Math.min(1, Math.max(0, alpha));
      return [
        foreground[0] * clampedAlpha + background[0] * (1 - clampedAlpha),
        foreground[1] * clampedAlpha + background[1] * (1 - clampedAlpha),
        foreground[2] * clampedAlpha + background[2] * (1 - clampedAlpha),
        1,
      ];
    };
    const elementOpacity = (element: HTMLElement): number => {
      const opacity = Number.parseFloat(getComputedStyle(element).opacity);
      return Number.isNaN(opacity) ? 1 : opacity;
    };
    const renderedBackground = (element: HTMLElement): Color => {
      const ancestors: HTMLElement[] = [];
      let current = element.parentElement;
      while (current !== null) {
        ancestors.push(current);
        current = current.parentElement;
      }

      let background: Color = [255, 255, 255, 1];
      for (const ancestor of ancestors.reverse()) {
        const layer = color(getComputedStyle(ancestor).backgroundColor);
        if (layer !== null) {
          background = blend(
            background,
            layer,
            layer[3] * elementOpacity(ancestor),
          );
        }
      }

      const layer = color(getComputedStyle(element).backgroundColor);
      return layer === null
        ? background
        : blend(background, layer, layer[3] * elementOpacity(element));
    };
    const renderedForeground = (
      element: HTMLElement,
      foreground: Color,
      background: Color,
    ): Color => {
      let alpha = foreground[3];
      let current: HTMLElement | null = element;
      while (current !== null) {
        alpha *= elementOpacity(current);
        current = current.parentElement;
      }
      return blend(background, foreground, alpha);
    };
    const hasHiddenAncestor = (element: HTMLElement): boolean => {
      let current: HTMLElement | null = element;
      while (current !== null) {
        const style = getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    };
    const contrastIssues: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(element);
      const rectangle = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        rectangle.width === 0 ||
        rectangle.height === 0 ||
        hasHiddenAncestor(element)
      )
        continue;
      const hasDirectText = [...element.childNodes].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE &&
          (node.textContent ?? "").trim() !== "",
      );
      const isControl = element.matches(
        "button, a, input, select, textarea, [role=button], [role=link]",
      );
      if (
        element.matches(':disabled, [aria-disabled="true"]') ||
        element.closest(':disabled, [aria-disabled="true"]') !== null
      ) {
        continue;
      }
      const hasSvg = element.querySelector("svg") !== null;
      const isGraphicControl = !hasDirectText && isControl && hasSvg;
      if (!hasDirectText && !isGraphicControl) continue;
      const foreground = color(style.color);
      if (foreground === null) continue;
      const background = renderedBackground(element);
      const largeText =
        Number.parseFloat(style.fontSize) >= 24 ||
        (Number.parseFloat(style.fontSize) >= 18.66 &&
          Number.parseInt(style.fontWeight) >= 700);
      const minimum = isGraphicControl || largeText ? 3 : 4.5;
      if (
        ratio(renderedForeground(element, foreground, background), background) <
        minimum
      ) {
        contrastIssues.push(
          `${element.tagName.toLowerCase()} ${foreground.join(",")} on ${background.join(",")}`,
        );
      }
    }
    return contrastIssues;
  });

  expect(issues, "rendered text and controls meet WCAG contrast").toEqual([]);
}

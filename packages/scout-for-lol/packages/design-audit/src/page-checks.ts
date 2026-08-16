import { expect, type Page } from "@playwright/test";

export async function waitForStablePage(page: Page): Promise<void> {
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
          // Broken images are reported by the browser error checks below.
        }
      }),
    );
  });
  await page.waitForLoadState("networkidle");
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
        rectangle.width > 0 &&
        rectangle.height > 0
      );
    };
    const allowed = (element: Element, attribute: string): boolean =>
      element.closest(`[${attribute}]`) !== null;
    const elements = [...document.querySelectorAll<HTMLElement>("*")].filter(
      (element) => visible(element),
    );
    const horizontalOverflow =
      document.documentElement.scrollWidth > window.innerWidth + 1;
    const clipped: string[] = [];
    const truncated: string[] = [];
    const smallControls: string[] = [];

    for (const element of elements) {
      const rectangle = element.getBoundingClientRect();
      if (
        rectangle.right > window.innerWidth + 1 &&
        rectangle.width < window.innerWidth &&
        !allowed(element, "data-design-audit-allow-overflow")
      ) {
        clipped.push(element.tagName.toLowerCase());
      }
      const style = getComputedStyle(element);
      const hasDirectText = [...element.childNodes].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE &&
          (node.textContent ?? "").trim() !== "",
      );
      if (
        hasDirectText &&
        style.overflow === "hidden" &&
        style.textOverflow !== "ellipsis" &&
        (element.scrollHeight > element.clientHeight + 1 ||
          element.scrollWidth > element.clientWidth + 1) &&
        !allowed(element, "data-design-audit-allow-truncation")
      ) {
        truncated.push(element.tagName.toLowerCase());
      }
      if (
        element.matches("button, input, select, textarea, [role=button]") &&
        (rectangle.width < 24 || rectangle.height < 24) &&
        !allowed(element, "data-design-audit-allow-small-target")
      ) {
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
      const rgba = /^rgba?\(([^)]+)\)$/.exec(value.replaceAll(" ", ""));
      if (rgba !== null) {
        const values = rgba[1]?.split(",");
        if (values === undefined || values.length < 3) return null;
        const red = Number(values[0]);
        const green = Number(values[1]);
        const blue = Number(values[2]);
        const alpha = values[3] === undefined ? 1 : Number(values[3]);
        if (
          [red, green, blue, alpha].some((component) => Number.isNaN(component))
        )
          return null;
        return [red, green, blue, alpha];
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
    const opaqueBackground = (element: HTMLElement): Color | null => {
      let current: HTMLElement | null = element;
      while (current !== null) {
        const background = color(getComputedStyle(current).backgroundColor);
        if (background !== null && background[3] >= 0.99) return background;
        current = current.parentElement;
      }
      return color(getComputedStyle(document.documentElement).backgroundColor);
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
        rectangle.height === 0
      )
        continue;
      const hasText = element.textContent.trim().length > 0;
      const isControl = element.matches(
        "button, a, input, select, textarea, [role=button], [role=link]",
      );
      const hasSvg = element.querySelector("svg") !== null;
      if (!hasText && !(isControl && hasSvg)) continue;
      const foreground = color(style.color);
      const background = opaqueBackground(element);
      if (foreground === null || background === null) continue;
      const largeText =
        Number.parseFloat(style.fontSize) >= 18 ||
        (Number.parseFloat(style.fontSize) >= 14 &&
          Number.parseInt(style.fontWeight) >= 700);
      const minimum = largeText ? 3 : 4.5;
      if (ratio(foreground, background) < minimum) {
        contrastIssues.push(
          `${element.tagName.toLowerCase()} ${foreground.join(",")} on ${background.join(",")}`,
        );
      }
    }
    return contrastIssues;
  });

  expect(issues, "rendered text and controls meet WCAG contrast").toEqual([]);
}

export async function assertKeyboardFocus(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus-visible");
  await expect(focused, "keyboard focus must remain visible").toHaveCount(1);
}

export async function assertInteractiveStates(page: Page): Promise<void> {
  const dialogs = page.locator('[role="dialog"]:visible');
  for (let index = 0; index < (await dialogs.count()); index += 1) {
    const dialog = dialogs.nth(index);
    await expect(dialog, "dialogs expose modal semantics").toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(
      await dialog
        .locator(
          'button[aria-label*="close" i], button:has-text("Close"), [data-dialog-close]',
        )
        .count(),
      "dialogs expose a keyboard-accessible close control",
    ).toBeGreaterThan(0);
  }

  const tabLists = page.locator('[role="tablist"]:visible');
  for (let index = 0; index < (await tabLists.count()); index += 1) {
    const tabList = tabLists.nth(index);
    const tabs = tabList.locator('[role="tab"]');
    expect(await tabs.count(), "tablists must contain tabs").toBeGreaterThan(0);
    const selected = tabList.locator('[role="tab"][aria-selected="true"]');
    await expect(selected, "tablists expose one selected tab").toHaveCount(1);
  }

  const menus = page.locator('[role="menu"]:visible');
  for (let index = 0; index < (await menus.count()); index += 1) {
    await expect(
      menus.nth(index).locator('[role="menuitem"]'),
      "menus expose menu items",
    ).not.toHaveCount(0);
  }

  const menuTrigger = page.locator(
    'button[aria-haspopup="menu"]:visible, [role="button"][aria-haspopup="menu"]:visible',
  );
  if ((await menuTrigger.count()) > 0) {
    await menuTrigger.first().click();
    await expect(
      page.locator('[role="menu"]:visible'),
      "menu triggers open a keyboard-addressable menu",
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]:visible')).toHaveCount(0);
  }
}

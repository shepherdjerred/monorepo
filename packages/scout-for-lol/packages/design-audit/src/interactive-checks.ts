import { expect, type Page } from "@playwright/test";
import { assertSemanticForms } from "#src/semantic-form-checks.ts";

/**
 * `role="dialog"` covers two different widgets, and only one of them is modal.
 *
 * A Radix Dialog is modal: it traps focus, renders an overlay, and sets
 * `aria-modal="true"`. A Radix Popover is NOT modal — it is anchored to its
 * trigger, leaves the rest of the page reachable, and per the ARIA practices
 * guide correctly omits `aria-modal`. Requiring modal semantics of both was
 * wrong, and failed on every page carrying a popover (484 failures on build
 * 10794).
 *
 * Popper-anchored content is identified by the positioning attributes Radix
 * puts on it (`data-side` / `data-align`), which a modal dialog never has.
 */
const MODAL_DIALOG =
  '[role="dialog"]:visible:not([data-side]):not([data-align])';

async function assertVisibleDialogs(page: Page): Promise<void> {
  // Matches dialogs that are not THEMSELVES popper-anchored. Deliberately not
  // `filter({ hasNot })`, which would also skip a genuine modal that happens to
  // contain a popover.
  const dialogs = page.locator(MODAL_DIALOG);
  const dialogCount = await dialogs.count();

  if (dialogCount > 0) {
    // The invariant is "the rest of the page is hidden from assistive tech",
    // NOT the presence of `aria-modal`. Radix deliberately never sets that
    // attribute — its source says so outright: "aria-hide everything except
    // the content (better supported equivalent to setting aria-modal)". The
    // old assertion therefore failed on every genuine Scout dialog as well as
    // on popovers, and satisfying it would mean asking Radix to adopt the
    // weaker technique.
    //
    // Radix marks body's other children `aria-hidden` while a modal is open,
    // so this is that behaviour observed directly.
    await expect(
      page.locator('body > [aria-hidden="true"]'),
      "an open modal hides the rest of the page from assistive technology",
    ).not.toHaveCount(0);
  }

  for (let index = 0; index < dialogCount; index += 1) {
    const dialog = dialogs.nth(index);
    await expect(dialog, "dialogs expose an accessible name").toHaveAttribute(
      "aria-labelledby",
      /.+/,
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
}

export async function assertInteractiveStates(page: Page): Promise<void> {
  const dialogTriggers = page.locator(
    '[aria-haspopup="dialog"]:visible:not([aria-label="Open navigation"]), [data-dialog-trigger]:visible',
  );
  const dialogTriggerCount = await dialogTriggers.count();
  for (let index = 0; index < dialogTriggerCount; index += 1) {
    const trigger = dialogTriggers.nth(index);
    const triggerDescription = await trigger.evaluate(
      (element) => element.outerHTML,
    );
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await expect(
      page.locator('[role="dialog"]:visible'),
      `dialog trigger opens a visible dialog: ${triggerDescription}`,
    ).not.toHaveCount(0);
    const radixDialog = page.locator('[role="dialog"][data-state="open"]');
    const openedRadixDialog = (await radixDialog.count()) > 0;
    await assertVisibleDialogs(page);
    await assertSemanticForms(page);
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
    if (openedRadixDialog) {
      await expect(
        page.locator('[role="dialog"][data-state]'),
        "closed Radix dialog portals detach before the next trigger",
      ).toHaveCount(0);
    }
  }

  await assertVisibleDialogs(page);

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
  const menuTriggerCount = await menuTrigger.count();
  for (let index = 0; index < menuTriggerCount; index += 1) {
    const trigger = menuTrigger.nth(index);
    await trigger.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    });
    await trigger.click({ force: true });
    await expect(
      page.locator('[role="menu"]:visible'),
      "menu triggers open a keyboard-addressable menu",
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]:visible')).toHaveCount(0);
  }
}

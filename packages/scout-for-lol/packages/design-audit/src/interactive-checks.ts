import { expect, type Page } from "@playwright/test";

async function assertVisibleDialogs(page: Page): Promise<void> {
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
}

export async function assertInteractiveStates(page: Page): Promise<void> {
  const dialogTriggers = page.locator(
    '[aria-haspopup="dialog"]:visible, [data-dialog-trigger]:visible',
  );
  for (let index = 0; index < (await dialogTriggers.count()); index += 1) {
    const trigger = dialogTriggers.nth(index);
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click({ force: true });
    await expect(
      page.locator('[role="dialog"]:visible'),
      "dialog triggers open a visible dialog",
    ).not.toHaveCount(0);
    await assertVisibleDialogs(page);
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
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

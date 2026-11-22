import { expect, type Locator } from "@playwright/test";
import {
  answerWrites,
  openManage,
  openRow,
  violations,
} from "./manage-support.ts";
import { horizontalOverflow, test } from "./support.ts";

/** The two controls of a duration field, by the field's visible label. */
function duration(form: Locator, label: string) {
  return {
    amount: form.getByRole("spinbutton", { name: label }),
    unit: form.getByRole("combobox", {
      name: `Unit of the ${label.toLowerCase()}`,
    }),
  };
}

test.describe("lengths of time", () => {
  test("a stored time is shown in the largest unit that states it exactly", async ({
    page,
  }) => {
    await openManage(page, "/manage/providers");
    await openRow(page, "AvistaZ");
    const form = page.getByRole("form", { name: "AvistaZ" });
    // Stored as 30, 259200, 3600, 259200, and 1209600 seconds.
    for (const [label, amount, unit] of [
      ["Shortest wait between requests", "30", "seconds"],
      ["Minimum seeding time", "3", "days"],
      ["Time for each GiB", "1", "hours"],
      ["Shortest size-based time", "3", "days"],
      ["Longest size-based time", "14", "days"],
    ] as const) {
      const field = duration(form, label);
      await expect(field.amount, label).toHaveValue(amount);
      await expect(field.unit, label).toHaveValue(unit);
    }
    // A wait is at most an hour, so it is not offered in hours or days.
    await expect(
      duration(form, "Shortest wait between requests").unit.locator("option"),
    ).toHaveText(["seconds", "minutes"]);
    await expect(
      duration(form, "Minimum seeding time").unit.locator("option"),
    ).toHaveText(["seconds", "minutes", "hours", "days"]);
    expect(await violations(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("a time is sent in seconds, whatever unit it was typed in", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/providers/*");
    await openManage(page, "/manage/providers");
    await openRow(page, "AvistaZ");
    const form = page.getByRole("form", { name: "AvistaZ" });
    for (const [label, amount, unit] of [
      ["Shortest wait between requests", "1.5", "minutes"],
      ["Minimum seeding time", "36", "hours"],
      ["Time for each GiB", "0.5", "seconds"],
      ["Shortest size-based time", "0.25", "days"],
      ["Longest size-based time", "", "hours"],
    ] as const) {
      const field = duration(form, label);
      await field.unit.selectOption(unit);
      await field.amount.fill(amount);
    }
    await form.getByRole("button", { name: "Save provider" }).click();
    await expect(form.getByRole("status")).toHaveText(
      "AvistaZ settings saved.",
    );
    expect(writes[0]?.body).toMatchObject({
      configuration: { minimumIntervalSeconds: 90 },
      seedingPolicy: {
        minimumSeconds: 129_600,
        sizeRule: {
          secondsPerGiB: 0.5,
          minimumSeconds: 21_600,
          maximumSeconds: null,
        },
      },
    });
  });

  test("a time that is not a whole number of seconds is refused beside its field until the amount or the unit makes it one", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/providers/*");
    await openManage(page, "/manage/providers");
    await openRow(page, "AvistaZ");
    const form = page.getByRole("form", { name: "AvistaZ" });
    const wait = duration(form, "Shortest wait between requests");
    const save = form.getByRole("button", { name: "Save provider" });

    // Leaving the field after an edit checks it.
    await wait.unit.selectOption("minutes");
    await wait.amount.fill("0.01");
    await wait.amount.press("Tab");
    await expect(wait.unit).toBeFocused();
    await expect(wait.amount).toHaveAttribute("aria-invalid", "true");
    await expect(wait.amount).toHaveAccessibleDescription(
      /Enter a whole number of seconds\. 0\.01 minutes is 0\.6 seconds\./u,
    );
    expect(await violations(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);

    // Nothing is rounded and sent.
    await save.click();
    await expect(form.getByRole("alert")).toContainText(
      "Shortest wait between requests: Enter a whole number of seconds.",
    );
    await expect(wait.amount).toBeFocused();
    expect(writes).toEqual([]);

    // The limit is stated in a unit the field offers.
    await wait.amount.fill("100");
    await save.click();
    await expect(wait.amount).toHaveAccessibleDescription(
      /Enter 60 minutes or less\./u,
    );
    expect(writes).toEqual([]);

    // The same amount in a smaller unit is a time the field takes, so
    // choosing that unit clears the error.
    await wait.unit.selectOption("seconds");
    await expect(wait.amount).toHaveAttribute("aria-invalid", "false");
    await expect(form.getByRole("alert")).toHaveCount(0);
    await save.click();
    await expect(form.getByRole("status")).toHaveText(
      "AvistaZ settings saved.",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({
      configuration: { minimumIntervalSeconds: 100 },
    });
  });
});

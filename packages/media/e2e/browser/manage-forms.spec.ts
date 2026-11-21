import { expect, test, type Page } from "@playwright/test";
import { MEMBER, OWNER } from "#testing/fixture-api/personas.ts";
import {
  answerWrites,
  openManage,
  overflowsSideways,
  storageContents,
  storedCommandKeys,
  violations,
} from "./manage-support.ts";

/** Opens a row that is closed until asked for, such as a provider. */
async function openRow(page: Page, name: string) {
  await page
    .locator("summary")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .click();
}

test.describe("household", () => {
  test("pausing a member's requests sends the change and says what was done", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/users/*");
    await openManage(page, "/manage/household");
    const mei = page.getByRole("listitem").filter({ hasText: "Mei" });
    await mei.getByRole("button", { name: "Pause requests" }).click();
    await expect(mei.getByRole("status")).toHaveText(
      "Requests paused for Mei.",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "PATCH",
      path: `/api/v1/admin/users/${MEMBER.id}`,
      body: { expectedVersion: MEMBER.version, restricted: true },
    });
    // The owner's own row offers nothing to change.
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: OWNER.displayName })
        .getByRole("button"),
    ).toHaveCount(0);
  });

  test("a refused change is explained on its row, and a retry is recognizably the same command", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/users/*", {
      status: 409,
      json: {
        error: {
          code: "version_conflict",
          message: "User changed or does not exist",
        },
      },
    });
    await openManage(page, "/manage/household");
    const mei = page.getByRole("listitem").filter({ hasText: "Mei" });
    const pause = mei.getByRole("button", { name: "Pause requests" });
    await pause.click();
    await expect(mei.getByRole("alert")).toHaveText(
      "Mei was not changed. User changed or does not exist",
    );
    expect(await violations(page)).toEqual([]);
    // The command's key is kept until the server acknowledges it.
    expect(await storedCommandKeys(page)).toHaveLength(1);
    await pause.click();
    await expect.poll(() => writes).toHaveLength(2);
    expect(writes[1]?.idempotencyKey).toBe(writes[0]?.idempotencyKey);
  });
});

test.describe("plex", () => {
  test("a match is confirmed in a dialog; Escape cancels and returns focus", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/plex/profiles");
    await openManage(page, "/manage/plex");
    const form = page.getByRole("form", { name: "Mei" });
    await form.getByLabel("Account on this server").selectOption("20417733");
    const submit = form.getByRole("button", { name: "Verify and save match" });
    await submit.click();

    const dialog = page.getByRole("dialog", { name: "Match Mei to mei?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(MEMBER.plexAccountId);
    await expect(dialog).toContainText("20417733");
    // The safe choice has focus, so Enter does not confirm by reflex.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(await violations(page)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(submit).toBeFocused();
    expect(writes).toEqual([]);

    await submit.click();
    await dialog
      .getByRole("button", { name: "Same person, save match" })
      .click();
    await expect(dialog).toBeHidden();
    await expect(form.getByRole("status")).toContainText(
      "Mei is matched to mei",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "PUT",
      path: "/api/v1/admin/plex/profiles",
    });
    expect(writes[0]?.body).toEqual({
      homeUserId: MEMBER.plexAccountId,
      serverAccountId: "20417733",
      expectedVersion: 1,
      confirmedIdentity: true,
    });
  });

  test("a protected profile needs its PIN, which is sent once and never stored", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/plex/profiles", {
      status: 422,
      json: { error: { code: "plex_pin", message: "Plex refused that PIN" } },
    });
    await openManage(page, "/manage/plex");
    const form = page.getByRole("form", { name: "Guest" });
    const pin = form.getByLabel("Plex Home PIN");
    await expect(pin).toHaveAttribute("type", "password");
    await expect(pin).toHaveAttribute("autocomplete", "off");
    await form.getByLabel("Account on this server").selectOption("31");
    await pin.fill("12");
    await form.getByRole("button", { name: "Verify and save match" }).click();
    await expect(pin).toBeFocused();
    await expect(pin).toHaveAccessibleDescription(
      /Enter the four digits of the PIN\./u,
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await pin.fill("4821");
    await form.getByRole("button", { name: "Verify and save match" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Same person, save match" })
      .click();
    await expect(form.getByRole("alert")).toContainText(
      "Plex refused that PIN",
    );
    expect(writes[0]?.body).toEqual({
      homeUserId: "9",
      serverAccountId: "31",
      expectedVersion: null,
      confirmedIdentity: true,
      pin: "4821",
    });
    // Even after a failure, nothing about a secret-bearing command is kept
    // in the browser's storage.
    expect(await storedCommandKeys(page)).toEqual([]);
    expect(await storageContents(page)).not.toContain("4821");
  });
});

test.describe("providers", () => {
  test("replacing stored sign-in details asks first", async ({ page }) => {
    const writes = await answerWrites(page, "/admin/providers/*");
    await openManage(page, "/manage/providers");
    await openRow(page, "PrivateHD");
    const form = page.getByRole("form", { name: "PrivateHD" });
    await form.getByRole("button", { name: "Replace sign-in details" }).click();
    await form.getByLabel("Username").fill("robin");
    await form.getByLabel("Password").fill("correct horse");
    await form.getByLabel("PID").fill("0123456789abcdef");
    await expect(form.getByLabel("Password")).toHaveAttribute(
      "type",
      "password",
    );
    const save = form.getByRole("button", { name: "Save provider" });
    await save.click();

    const dialog = page.getByRole("dialog", {
      name: "Replace the sign-in details for PrivateHD?",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(await violations(page)).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(writes).toEqual([]);

    await save.click();
    await dialog.getByRole("button", { name: "Replace and save" }).click();
    await expect(form.getByRole("status")).toHaveText(
      "PrivateHD settings saved.",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "PUT",
      path: "/api/v1/admin/providers/privatehd",
      body: {
        enabled: true,
        configuration: {
          minimumIntervalSeconds: 60,
          dailyDownloadLimit: 8,
          selection: {
            priority: 1,
            minimumSeeders: 1,
            delaySeconds: 0,
            bypassAtHighestQuality: false,
          },
        },
        seedingPolicy: {
          kind: "privatehd",
          verified: true,
          evidence: "Rules page reviewed 2026-10-02: ratio 0.9 or seven days.",
          ratio: 0.9,
        },
        credential: {
          username: "robin",
          password: "correct horse",
          pid: "0123456789abcdef",
        },
      },
    });
    expect(await storedCommandKeys(page)).toEqual([]);
  });

  test("a save that leaves the sign-in details alone sends none and asks nothing", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/providers/*");
    await openManage(page, "/manage/providers");
    await openRow(page, "AvistaZ");
    const form = page.getByRole("form", { name: "AvistaZ" });
    const interval = form.getByLabel("Shortest wait between requests");
    const evidence = form.getByLabel("Where these rules come from");

    await interval.fill("0");
    await evidence.fill("");
    await form.getByRole("button", { name: "Save provider" }).click();
    await expect(form.getByRole("alert")).toContainText(
      "2 fields need attention",
    );
    await expect(interval).toBeFocused();
    await expect(interval).toHaveAccessibleDescription(/Enter 1 or more\./u);
    await expect(evidence).toHaveAttribute("aria-invalid", "true");
    expect(await violations(page)).toEqual([]);
    expect(writes).toEqual([]);

    await interval.fill("90");
    await evidence.fill("Tracker wiki, section Seeding, checked today.");
    await form.getByLabel("Use this provider").uncheck();
    await form.getByRole("button", { name: "Save provider" }).click();
    await expect(form.getByRole("status")).toHaveText(
      "AvistaZ settings saved.",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes[0]?.body).toMatchObject({
      enabled: false,
      configuration: { minimumIntervalSeconds: 90, dailyDownloadLimit: 10 },
      seedingPolicy: {
        kind: "private",
        verified: true,
        evidence: "Tracker wiki, section Seeding, checked today.",
        ratio: 1,
        minimumSeconds: 259_200,
        combination: "any",
        sizeRule: {
          secondsPerGiB: 3600,
          minimumSeconds: 259_200,
          maximumSeconds: 1_209_600,
        },
      },
    });
    expect(writes[0]?.body).not.toHaveProperty("credential");
  });

  test("a provider list with a state this client does not know is an error, not a guess", async ({
    page,
  }) => {
    let answers = 0;
    await page.route("**/api/v1/admin/providers", async (route) => {
      answers += 1;
      const response = await route.fetch();
      if (answers > 1) {
        await route.fulfill({ response });
        return;
      }
      const body = await response.text();
      await route.fulfill({
        response,
        body: body.replace('"feedState":"catching_up"', '"feedState":"asleep"'),
      });
    });
    await openManage(page, "/manage/providers");
    const report = page.getByRole("alert");
    await expect(report).toContainText("Providers could not be loaded");
    await expect(page.locator("summary")).toHaveCount(0);
    expect(await violations(page)).toEqual([]);
    await report.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByRole("heading", { name: "PrivateHD" }),
    ).toBeVisible();
  });
});

test.describe("numbering", () => {
  test("an episode's release number is saved with its evidence, and can be removed", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/numbering/episodes/*");
    await openManage(page, "/manage/numbering");
    await page.getByLabel("Series", { exact: true }).selectOption({ index: 1 });
    await openRow(page, "S1 E2: Episode 2");
    const form = page.getByRole("form", { name: "S1 E2: Episode 2" });
    const number = form.getByLabel("Release number");
    const evidence = form.getByLabel("Where this number comes from");
    await expect(number).toHaveValue("2");

    await number.fill("14");
    await evidence.fill("short");
    await form.getByRole("button", { name: "Save number" }).click();
    await expect(evidence).toBeFocused();
    await expect(evidence).toHaveAccessibleDescription(
      /Use at least 10 characters\./u,
    );
    expect(writes).toEqual([]);

    await evidence.fill("AniDB episode list, checked today.");
    await form.getByRole("button", { name: "Save number" }).click();
    await expect(form.getByRole("status")).toHaveText(
      "S1 E2 saved as release number 14.",
    );
    expect(writes[0]).toMatchObject({
      method: "PUT",
      body: {
        expectedVersion: 1,
        absoluteNumber: 14,
        evidence: "AniDB episode list, checked today.",
      },
    });

    await number.fill("");
    await form.getByRole("button", { name: "Save number" }).click();
    await expect(form.getByRole("status")).toHaveText(
      "Release number removed from S1 E2.",
    );
    expect(writes[1]?.body).toMatchObject({ absoluteNumber: null });
    expect(await violations(page)).toEqual([]);
    expect(await overflowsSideways(page)).toBe(false);
  });
});

test.describe("subtitles", () => {
  test("a subtitle file is read and sent only once its match is confirmed", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/subtitles", {
      json: { status: "queued" },
    });
    await openManage(page, "/manage/subtitles");
    const form = page.getByRole("form", { name: "Subtitle details" });
    await form
      .getByLabel("Video file", { exact: true })
      .selectOption({ index: 1 });
    await form.getByLabel("Simplified Chinese").check();
    await form.getByLabel("Subtitle file", { exact: true }).setInputFiles({
      name: "film.zh.srt",
      mimeType: "application/x-subrip",
      buffer: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n你好\n"),
    });
    await form
      .getByLabel("Where it comes from and how it matches")
      .fill("Translated by hand for the theatrical cut.");
    const confirm = form.getByLabel(
      "I checked that this subtitle matches the chosen video file and episode",
    );
    await form.getByRole("button", { name: "Check and add subtitle" }).click();
    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveAccessibleDescription(
      "Confirm the match before sending the file.",
    );
    expect(writes).toEqual([]);

    await confirm.check();
    await form.getByRole("button", { name: "Check and add subtitle" }).click();
    await expect(form.getByRole("status")).toHaveText(
      "Subtitle checked and queued to be installed.",
    );
    expect(writes[0]).toMatchObject({
      method: "POST",
      body: {
        language: "zh-Hans",
        forced: false,
        filename: "film.zh.srt",
        description: "Translated by hand for the theatrical cut.",
        confirmedMatchingVideo: true,
        contentBase64: Buffer.from(
          "1\n00:00:01,000 --> 00:00:02,000\n你好\n",
        ).toString("base64"),
      },
    });
    expect(writes[0]?.body).not.toHaveProperty("replacementFor");
    expect(writes[0]?.body).not.toHaveProperty("hearingImpaired");
  });

  test("a file of the wrong kind is refused beside the file field", async ({
    page,
  }) => {
    await openManage(page, "/manage/subtitles");
    const form = page.getByRole("form", { name: "Subtitle details" });
    const file = form.getByLabel("Subtitle file", { exact: true });
    await file.setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a subtitle"),
    });
    await form.getByRole("button", { name: "Check and add subtitle" }).click();
    await expect(file).toHaveAccessibleDescription(
      /Choose an SRT, ASS, SSA, or WebVTT file\./u,
    );
    expect(await violations(page)).toEqual([]);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("open provider forms are accessible and fit the window", async ({
      page,
    }) => {
      await openManage(page, "/manage/providers");
      await openRow(page, "AvistaZ");
      await openRow(page, "OpenSubtitles");
      await page
        .getByRole("form", { name: "OpenSubtitles" })
        .getByRole("button", { name: "Replace sign-in details" })
        .click();
      expect(await violations(page)).toEqual([]);
      expect(await overflowsSideways(page)).toBe(false);
    });

    test("the other Manage forms fit the window", async ({ page }) => {
      for (const path of [
        "/manage/household",
        "/manage/subtitles",
        "/manage/plex",
      ]) {
        await openManage(page, path);
        expect(await overflowsSideways(page), path).toBe(false);
      }
    });
  });
}

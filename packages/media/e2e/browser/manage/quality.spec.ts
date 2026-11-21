import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { QualityRulesSchema } from "#shared/api.ts";
import {
  PROFILE_IDS,
  profileList,
} from "#testing/fixture-api/fixtures/profiles.ts";
import {
  answerWrites,
  openManage,
  overflowsSideways,
  violations,
} from "./support.ts";
import { test } from "#e2e/browser/support.ts";

const HD = "HD 1080p — Movies";

/** The profile list, as far as a test needs to reach into it. */
const CapturedProfiles = z.array(
  z.looseObject({
    id: z.string(),
    rules: z.looseObject({
      resolved: z.looseObject({ source: z.string() }).optional(),
    }),
  }),
);

function fixtureProfile(id: string) {
  const profile = profileList().find((entry) => entry.id === id);
  if (profile === undefined) throw new Error(`No fixture profile ${id}`);
  return { ...profile, rules: QualityRulesSchema.parse(profile.rules) };
}

function editor(page: Page, name: string) {
  return page.getByRole("form", { name, exact: true });
}

/** Opens a profile's row the way a keyboard does: focus its summary, press Enter. */
async function openProfile(page: Page, name: string) {
  const row = page.locator("summary").filter({ hasText: name });
  await row.focus();
  await page.keyboard.press("Enter");
}

test.describe("the quality profile form", () => {
  test("is filled in, reordered, and submitted with the keyboard alone", async ({
    page,
  }) => {
    const stored = fixtureProfile(PROFILE_IDS.moviesHd);
    const writes = await answerWrites(page, "/admin/profiles", {
      json: { profileId: stored.id, version: 4, status: "completed" },
    });
    await openManage(page, "/manage/quality");
    await openProfile(page, HD);
    const form = editor(page, HD);
    const qualities = form.getByRole("group", {
      name: "Qualities, most wanted first",
    });
    await expect(qualities.getByRole("listitem")).toHaveText([
      /Bluray-1080p/u,
      /WEBDL-1080p/u,
      /WEBDL-720p/u,
    ]);

    // Move the last quality to the top, one place at a time. Focus stays
    // on the quality being moved.
    const up = qualities.getByRole("button", { name: "Move WEBDL-720p up" });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect(up).toBeFocused();
    await expect(qualities.getByRole("status")).toHaveText(
      "WEBDL-720p moved up, now 2 of 3.",
    );
    await page.keyboard.press("Enter");
    // At the top "up" is disabled, so focus moves to its twin.
    await expect(up).toBeDisabled();
    await expect(
      qualities.getByRole("button", { name: "Move WEBDL-720p down" }),
    ).toBeFocused();
    await expect(qualities.getByRole("listitem")).toHaveText([
      /WEBDL-720p/u,
      /Bluray-1080p/u,
      /WEBDL-1080p/u,
    ]);

    // Add a quality from the suggestions.
    const picker = qualities.getByLabel("Add a quality");
    await picker.focus();
    await picker.selectOption("Remux-1080p");
    await page.keyboard.press("Tab");
    await expect(
      qualities.getByRole("button", { name: "Add", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(qualities.getByRole("listitem")).toHaveCount(4);

    // Add a score for a trait. The new row takes focus.
    const scores = form.getByRole("group", { name: "Scores" });
    await scores.getByRole("button", { name: "Add a score" }).focus();
    await page.keyboard.press("Enter");
    await expect(scores.getByLabel("Trait, row 7")).toBeFocused();
    await page.keyboard.type("HDR");
    await page.keyboard.press("Tab");
    await expect(scores.getByLabel("Score for HDR")).toBeFocused();
    await page.keyboard.type("250");

    await expect(form.getByText("Unsaved changes")).toBeVisible();
    // Enter in a field submits the form.
    await page.keyboard.press("Enter");
    await expect(form.getByText(`${HD} saved as version 4.`)).toBeVisible();
    await expect(form.getByText("Unsaved changes")).toHaveCount(0);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/admin/profiles",
    });
    // Everything the form did not touch is sent back as it was stored.
    expect(writes[0]?.body).toEqual({
      id: stored.id,
      name: stored.name,
      expectedVersion: stored.version,
      rules: {
        ...stored.rules,
        // Stored least wanted first: the reverse of the list on screen.
        qualities: ["Remux-1080p", "WEBDL-1080p", "Bluray-1080p", "WEBDL-720p"],
        tagScores: { ...stored.rules.tagScores, HDR: 250 },
      },
    });
  });

  test("shows what is wrong beside each field and in a summary, and moves focus", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/profiles");
    await openManage(page, "/manage/quality");
    await openProfile(page, HD);
    const form = editor(page, HD);
    const name = form.getByLabel("Name", { exact: true });
    const largest = form.getByLabel("Largest file", { exact: true });
    // Nothing is flagged while a field is still being edited.
    await name.fill("");
    await expect(name).toHaveAttribute("aria-invalid", "false");
    await largest.fill("0.1");
    await form.getByRole("button", { name: "Save new version" }).click();

    const summary = form.getByRole("alert");
    await expect(summary).toContainText("2 fields need attention");
    await expect(summary.getByRole("button")).toHaveText([
      "Name: Give the profile a name.",
      "Largest file: The largest file cannot be smaller than the smallest.",
    ]);
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAccessibleDescription("Give the profile a name.");
    await expect(largest).toHaveAttribute("aria-invalid", "true");
    expect(await violations(page)).toEqual([]);
    expect(writes).toEqual([]);

    // The summary's entries lead to their fields.
    await summary.getByRole("button", { name: /^Largest file/u }).click();
    await expect(largest).toBeFocused();

    // An error clears as soon as its field is acceptable again.
    await name.fill("HD movies");
    await expect(name).toHaveAttribute("aria-invalid", "false");
    await expect(summary).toContainText("1 field needs attention");
  });

  test("keeps a captured Radarr profile as JSON and checks it before saving", async ({
    page,
  }) => {
    const stored = fixtureProfile(PROFILE_IDS.captured);
    const writes = await answerWrites(page, "/admin/profiles", {
      json: { profileId: stored.id, version: 2, status: "completed" },
    });
    await openManage(page, "/manage/quality");
    await openProfile(page, stored.name);
    const form = editor(page, stored.name);
    const json = form.getByLabel("Captured profile (JSON)");
    await expect(json).toBeHidden();

    // A broken snapshot is refused, and its closed section opens to show why.
    await form.locator("summary").filter({ hasText: "Advanced" }).click();
    await json.fill('{"source":"lidarr"}');
    await form.locator("summary").filter({ hasText: "Advanced" }).click();
    await form.getByRole("button", { name: "Save new version" }).click();
    await expect(json).toBeFocused();
    await expect(json).toHaveAccessibleDescription(
      /This is not a captured profile\./u,
    );
    expect(writes).toEqual([]);

    // Left as it was loaded, the snapshot is sent back whole.
    await json.fill(JSON.stringify(stored.rules.resolved));
    await form.getByRole("button", { name: "Save new version" }).click();
    await expect(form.getByText("saved as version 2")).toBeVisible();
    expect(writes[0]?.body).toEqual({
      id: stored.id,
      name: stored.name,
      expectedVersion: stored.version,
      rules: stored.rules,
    });
  });

  test("creates a profile from nothing", async ({ page }) => {
    const writes = await answerWrites(page, "/admin/profiles", {
      json: { profileId: PROFILE_IDS.anime, version: 1, status: "completed" },
    });
    await openManage(page, "/manage/quality");
    await openProfile(page, "Start a new profile");
    const form = editor(page, "Start a new profile");
    await form.getByRole("button", { name: "Create profile" }).click();
    await expect(form.getByRole("alert")).toContainText(
      "5 fields need attention",
    );
    await form.getByLabel("Name", { exact: true }).fill("Small files");
    const qualities = form.getByRole("group", {
      name: "Qualities, most wanted first",
    });
    await qualities.getByLabel("Add a quality").selectOption("WEB-720p");
    await qualities.getByRole("button", { name: "Add", exact: true }).click();
    // A name that is not suggested is typed, and Enter adds it.
    await qualities.getByLabel("Add a quality").selectOption("__other__");
    await qualities.getByLabel("Quality name").fill("WEBDL-720p");
    await page.keyboard.press("Enter");
    await expect(qualities.getByLabel("Add a quality")).toBeFocused();
    await form.getByLabel("Smallest file", { exact: true }).fill("0");
    await form.getByLabel("Largest file", { exact: true }).fill("1.5");
    await form.getByLabel("Quality to stop at").selectOption("WEB-720p");
    await form.getByRole("button", { name: "Create profile" }).click();
    await expect(
      form.getByText("Small files saved as version 1."),
    ).toBeVisible();
    expect(writes[0]?.body).toEqual({
      name: "Small files",
      expectedVersion: 0,
      rules: {
        qualities: ["WEBDL-720p", "WEB-720p"],
        rejectedCodecs: [],
        requiredAudioLanguages: [],
        minimumBytes: 0,
        maximumBytes: 1.5 * 1024 ** 3,
        minimumScore: 0,
        tagScores: {},
        cutoffQuality: "WEB-720p",
        cutoffScore: 0,
      },
    });
  });
});

test.describe("profiles this page cannot edit", () => {
  test("a profile whose rules hold an unknown value is reported, not shown as a form", async ({
    page,
  }) => {
    await page.route("**/api/v1/profiles", async (route) => {
      const response = await route.fetch();
      const profiles = CapturedProfiles.parse(await response.json());
      const captured = profiles.find(
        (profile) => profile.id === PROFILE_IDS.captured,
      );
      // A source application this client has never heard of.
      if (captured?.rules.resolved === undefined) {
        throw new Error("No captured profile");
      }
      captured.rules.resolved.source = "lidarr";
      await route.fulfill({ response, json: profiles });
    });
    await openManage(page, "/manage/quality");
    const name = "HD-1080p from Radarr";
    const row = page.locator("details").filter({
      has: page.getByRole("heading", { name, exact: true }),
    });
    await expect(row.getByText("Cannot be read")).toBeVisible();
    await openProfile(page, name);
    const report = row.getByRole("alert");
    await expect(report).toContainText("This profile cannot be edited here");
    await expect(report).toContainText("resolved.source");
    await expect(editor(page, name)).toHaveCount(0);
    expect(await violations(page)).toEqual([]);

    // The rest of the page is unaffected.
    await openProfile(page, HD);
    await expect(editor(page, HD)).toBeVisible();
  });

  test("a profile that follows the guide points to the guide", async ({
    page,
  }) => {
    await openManage(page, "/manage/quality");
    const name = "Living room 4K — Movies";
    await openProfile(page, name);
    const row = page.locator("details").filter({
      has: page.getByRole("heading", { name, exact: true }),
    });
    await expect(
      row.getByRole("link", { name: "Living-room guide" }),
    ).toBeVisible();
    await expect(editor(page, name)).toHaveCount(0);
  });
});

test.describe("the living-room guide", () => {
  test("previews with typed overrides, then applies what was previewed", async ({
    page,
  }) => {
    const movies = fixtureProfile(PROFILE_IDS.movies4k);
    const guide = movies.rules.managedGuide;
    if (guide === undefined) throw new Error("The fixture is not managed");
    const formatId = "0123456789abcdef0123456789abcdef";
    const previews = await answerWrites(page, "/admin/quality-guide/preview", {
      json: {
        kind: "movie",
        name: movies.name,
        revision: guide.revision,
        contentHash: guide.contentHash,
        rules: movies.rules,
      },
    });
    const applies = await answerWrites(page, "/admin/quality-guide/apply", {
      json: { profileId: movies.id, version: 8, status: "completed" },
    });
    await openManage(page, "/manage/quality");
    const form = page.getByRole("form", { name: "Review the current guide" });
    const overrides = form.getByRole("group", { name: "Score overrides" });
    await overrides.getByRole("button", { name: "Add an override" }).click();
    await overrides.getByLabel("TRaSH format ID, row 1").fill("not-an-id");
    await overrides.getByLabel(/^Score for/u).fill("250");
    await form.getByRole("button", { name: "Preview current guide" }).click();
    await expect(overrides.getByLabel("TRaSH format ID, row 1")).toBeFocused();
    await expect(
      overrides.getByLabel("TRaSH format ID, row 1"),
    ).toHaveAccessibleDescription(/32 characters of the format ID/u);
    expect(previews).toEqual([]);

    await overrides.getByLabel("TRaSH format ID, row 1").fill(formatId);
    await form.getByRole("button", { name: "Preview current guide" }).click();
    await expect(page.getByText("upgrading up to Remux-2160p")).toBeVisible();
    expect(previews[0]?.body).toEqual({
      kind: "movie",
      scoreOverrides: { [formatId]: 250 },
    });

    await page.getByRole("button", { name: "Apply reviewed profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    // The apply carries the reviewed guide's own identity, not the form's.
    expect(applies[0]?.body).toEqual({
      kind: "movie",
      scoreOverrides: guide.scoreOverrides,
      expectedRevision: guide.revision,
      expectedContentHash: guide.contentHash,
      profileId: null,
      expectedVersion: 0,
    });
  });

  test("makes a living-room profile the default for new requests", async ({
    page,
  }) => {
    await page.route("**/api/v1/profile-defaults", (route) =>
      route.fulfill({ json: [] }),
    );
    const writes = await answerWrites(page, "/admin/profile-defaults/movie");
    await openManage(page, "/manage/quality");
    await page
      .getByRole("button", { name: "Use for new movie requests" })
      .click();
    await expect.poll(() => writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "PUT",
      body: { profileId: PROFILE_IDS.movies4k, expectedVersion: 0 },
    });
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("the open profile editors are accessible and fit the window", async ({
      page,
    }) => {
      await openManage(page, "/manage/quality");
      await openProfile(page, HD);
      await openProfile(page, "HD-1080p from Radarr");
      await editor(page, "HD-1080p from Radarr")
        .locator("summary")
        .filter({ hasText: "Advanced" })
        .click();
      await openProfile(page, "Start a new profile");
      await page.getByRole("button", { name: "Add an override" }).click();
      await expect(editor(page, "Start a new profile")).toBeVisible();
      expect(await violations(page)).toEqual([]);
      expect(await overflowsSideways(page)).toBe(false);
    });
  });
}

import { expect, test } from "@playwright/test";

test("Brim shows provider reconnect status, billing, usage and priorities", async ({
  page,
}) => {
  await page.goto("/brim");
  await expect(page).toHaveTitle("Brim · Hub");
  await expect(
    page.getByRole("heading", { name: "Brim", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Sign in on MacBook")).toBeVisible();
  await expect(page.getByText("$12.30")).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Windows" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Brim views" });
  await nav.getByRole("link", { name: "Usage" }).click();
  await expect(
    page.getByRole("heading", { name: "Tokens and estimated cost" }),
  ).toBeVisible();
  await expect(page.getByText("249,750 tokens")).toBeVisible();
  await nav.getByRole("link", { name: "Herdr priorities" }).click();
  await expect(
    page.getByRole("row", { name: /Check Brim sync.*P1/u }),
  ).toBeVisible();
});

test("Brim searches transcripts and shows reconstructed and raw requests", async ({
  page,
}) => {
  await page.goto("/brim/sessions");
  await page.getByRole("searchbox", { name: "Transcript text" }).fill("ArgoCD");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("link", { name: "Prune stale ArgoCD applications" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transcript", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Captured requests" })
    .getByRole("link")
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Reconstructed context" }),
  ).toBeVisible();
  await page.getByText("Raw request", { exact: true }).click();
  await expect(page.getByText(/previous_response_id/u)).toBeVisible();
});

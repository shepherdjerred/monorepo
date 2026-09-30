import { expect, test } from "@playwright/test";

test("semantic form examples preserve native browser behavior", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?viewMode=story&id=components-forms-field--semantic-form-states",
  );
  const form = page.getByRole("form", { name: "Semantic form states" });
  const title = form.locator('input[name="title"]');
  const email = form.locator('input[name="email"]');

  await expect(title).toHaveAttribute("required", "");
  await expect(email).toHaveAttribute("type", "email");
  expect(
    await form.evaluate((element) => {
      if (!(element instanceof HTMLFormElement)) {
        throw new TypeError("form locator returned a non-form element");
      }
      return element.checkValidity();
    }),
  ).toBe(false);
  expect(
    await title.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) {
        throw new TypeError("title locator returned a non-input element");
      }
      return element.validationMessage;
    }),
  ).not.toBe("");
  await expect(form.locator('[aria-invalid="true"]')).toHaveAttribute(
    "aria-describedby",
    "form-zod-invalid-error",
  );
  await expect(form.locator("#form-zod-invalid-error")).toHaveCount(1);
  await expect(form.locator('input[name="disabled-value"]')).toBeDisabled();

  await title.fill("Changed title");
  await form.getByRole("button", { name: "Reset" }).click();
  await expect(title).toHaveValue("");
});

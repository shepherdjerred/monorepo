import { expect, type Page } from "@playwright/test";

export async function assertSemanticForms(page: Page): Promise<void> {
  const findings = await page.locator("form:visible").evaluateAll((forms) => {
    const missingNames: string[] = [];
    const missingLabels: string[] = [];

    for (const form of forms) {
      if (!(form instanceof HTMLFormElement)) {
        throw new TypeError("form locator returned a non-form element");
      }
      const controls = form.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >(
        ':is(input, select, textarea):not([type="hidden"]):not([aria-hidden="true"]):not(.monaco-editor *)',
      );
      for (const control of controls) {
        const description = control.outerHTML.slice(0, 500);
        if (control.name.length === 0) missingNames.push(description);
        const labelCount = control.labels === null ? 0 : control.labels.length;
        const ariaLabel = control.getAttribute("aria-label")?.trim() ?? "";
        const labelledBy =
          control.getAttribute("aria-labelledby")?.trim() ?? "";
        if (labelCount === 0 && ariaLabel === "" && labelledBy === "") {
          missingLabels.push(description);
        }
      }
    }

    return { missingNames, missingLabels };
  });

  expect(findings.missingNames, "form controls expose stable names").toEqual(
    [],
  );
  expect(
    findings.missingLabels,
    "form controls expose accessible labels",
  ).toEqual([]);
}

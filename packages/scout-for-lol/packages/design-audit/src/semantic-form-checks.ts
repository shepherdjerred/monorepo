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
      >("input, select, textarea");
      for (const control of controls) {
        if (
          control.getAttribute("aria-hidden") === "true" ||
          control.closest(".monaco-editor") !== null
        ) {
          continue;
        }
        const description = control.outerHTML.slice(0, 500);
        if (control.name.length === 0) missingNames.push(description);
        if (control instanceof HTMLInputElement && control.type === "hidden") {
          continue;
        }
        const hasAccessibleLabel =
          (control.labels !== null && control.labels.length > 0) ||
          (control.getAttribute("aria-label")?.trim().length ?? 0) > 0 ||
          (control.getAttribute("aria-labelledby")?.trim().length ?? 0) > 0;
        if (!hasAccessibleLabel) missingLabels.push(description);
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

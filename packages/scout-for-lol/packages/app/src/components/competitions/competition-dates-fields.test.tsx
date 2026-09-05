import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompetitionDatesFields } from "#src/components/competitions/competition-dates-fields.tsx";

function ignore(): void {
  // Static accessibility rendering does not invoke interaction callbacks.
}

describe("CompetitionDatesFields", () => {
  test("links a cross-field date error to the invalid end-date control", () => {
    const html = renderToStaticMarkup(
      <CompetitionDatesFields
        value={{
          mode: "FIXED_DATES",
          startDate: "2026-08-25",
          endDate: "2026-08-24",
          seasonId: "",
        }}
        timezone="America/Los_Angeles"
        errors={{
          startDate: undefined,
          endDate: "End date must be after the start date.",
          seasonId: undefined,
        }}
        onChange={ignore}
        onTimezoneChange={ignore}
      />,
    );

    expect(html).toContain('id="competition-end"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="competition-end-error"');
    expect(html).toContain('id="competition-end-error"');
    expect(html).toContain("End date must be after the start date.");
  });
});

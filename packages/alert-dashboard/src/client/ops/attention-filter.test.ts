import { describe, expect, it } from "vitest";

import {
  ATTENTION_PARAM,
  WAITING_PATH,
  parseAttentionFilter,
  withAttentionFilter,
} from "./attention-filter.ts";

describe("the attention filter parameter", () => {
  it("shows everything unless the value is a known filter", () => {
    expect(parseAttentionFilter(null)).toBe("all");
    expect(parseAttentionFilter("")).toBe("all");
    expect(parseAttentionFilter("all")).toBe("all");
    expect(parseAttentionFilter("waiting")).toBe("waiting");
    expect(parseAttentionFilter("Waiting")).toBe("all");
    expect(parseAttentionFilter("everything")).toBe("all");
  });

  it("links the waiting view as a parameter the parser reads back", () => {
    const url = new URL(WAITING_PATH, "https://hub.example");
    expect(url.pathname).toBe("/");
    expect(parseAttentionFilter(url.searchParams.get(ATTENTION_PARAM))).toBe(
      "waiting",
    );
  });

  it("sets the waiting filter and keeps the other parameters", () => {
    const updated = withAttentionFilter(
      new URLSearchParams("range=7d"),
      "waiting",
    );
    expect(updated.toString()).toBe("range=7d&show=waiting");
  });

  it("drops the parameter for the default, leaving the plain Home URL", () => {
    const updated = withAttentionFilter(
      new URLSearchParams("show=waiting&range=7d"),
      "all",
    );
    expect(updated.toString()).toBe("range=7d");
  });

  it("does not change the params it was given", () => {
    const params = new URLSearchParams("show=waiting");
    withAttentionFilter(params, "all");
    expect(params.toString()).toBe("show=waiting");
  });
});

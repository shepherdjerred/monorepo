import { describe, expect, test } from "vitest";
import { createRequestIds } from "./request-ids.ts";

function ids(limit: number, ttlMs: number) {
  let clock = 0;
  let counter = 0;
  const requests = createRequestIds({
    limit,
    ttlMs,
    now: () => clock,
    uuid: () => {
      counter += 1;
      return `id-${String(counter)}`;
    },
  });
  return {
    requests,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("own request IDs", () => {
  test("an issued ID is this tab's; an unknown one is not", () => {
    const { requests } = ids(10, 1000);
    const id = requests.next();
    expect(requests.has(id)).toBe(true);
    expect(requests.has("someone-else")).toBe(false);
  });

  test("only the newest IDs are kept", () => {
    const { requests } = ids(2, 1000);
    const first = requests.next();
    const second = requests.next();
    const third = requests.next();
    expect([first, second, third].map((id) => requests.has(id))).toEqual([
      false,
      true,
      true,
    ]);
  });

  test("an ID is forgotten once its time is up", () => {
    const { requests, advance } = ids(10, 1000);
    const old = requests.next();
    advance(600);
    const recent = requests.next();
    advance(500);
    expect(requests.has(old)).toBe(false);
    expect(requests.has(recent)).toBe(true);
  });
});

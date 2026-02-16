import { parseChord } from "./chord.js";

describe("chord", () => {
  describe("parseChord", () => {
    test("works in simple case", () => {
      expect(parseChord("a a")).toEqual([
        {
          command: "a",
          quantity: 1,
        },
        {
          command: "a",
          quantity: 1,
        },
      ]);

      expect(parseChord("2a a 2a a")).toEqual([
        {
          command: "a",
          quantity: 2,
        },
        {
          command: "a",
          quantity: 1,
        },
        {
          command: "a",
          quantity: 2,
        },
        {
          command: "a",
          quantity: 1,
        },
      ]);
    });

    test("works in weird casess", () => {
      expect(parseChord("2000a 0a 2a a")).toEqual([
        {
          command: "a",
          quantity: 2000,
        },
        {
          command: "a",
          quantity: 0,
        },
        {
          command: "a",
          quantity: 2,
        },
        {
          command: "a",
          quantity: 1,
        },
      ]);
    });

    test("handles failure", () => {
      expect(parseChord("2 a a a")).toEqual(undefined);
      expect(parseChord("2 2")).toEqual(undefined);
      expect(parseChord("")).toEqual(undefined);
      expect(parseChord("applesauce")).toEqual(undefined);
    });
  });
});

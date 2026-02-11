import { commandToGameboyAdvanceKeyInput, parseGameboyAdvanceKeyInput } from "./keybinds.js";

describe("keybinds", () => {
  describe("parseGameboyAdvanceKeyInput", () => {
    test("works", () => {
      expect(parseGameboyAdvanceKeyInput("2a a a")).toEqual(["Z", "Z", "Z", "Z"]);
      expect(parseGameboyAdvanceKeyInput("a")).toEqual(["Z"]);
      expect(parseGameboyAdvanceKeyInput("2")).toEqual(undefined);
      expect(parseGameboyAdvanceKeyInput("")).toEqual(undefined);
      expect(parseGameboyAdvanceKeyInput("A")).toEqual(["Z"]);
    });
  });

  describe("commandToGameboyAdvanceKeyInput", () => {
    test("works", () => {
      expect(commandToGameboyAdvanceKeyInput({ command: "a", quantity: 2 })).toEqual(["Z", "Z"]);
    });
  });
});

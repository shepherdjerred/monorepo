import { parseCommandInput } from "./commandInput.js";

describe("commandInput", () => {
  describe("parseCommandInput", () => {
    test("works in simple case", () => {
      ["u", "d", "l", "r", "a", "b", "se", "st"].forEach((command) => {
        expect(parseCommandInput(command)).toEqual({
          command: command,
          quantity: 1,
        });
      });
    });

    test("can parse quantity", () => {
      expect(parseCommandInput("2u")).toEqual({
        command: "u",
        quantity: 2,
      });
    });

    test("can parse multiple digit quantity", () => {
      expect(parseCommandInput("20d")).toEqual({
        command: "d",
        quantity: 20,
      });
    });

    test("can parse absurd strings", () => {
      expect(parseCommandInput("20000000d")).toEqual({
        command: "d",
        quantity: 20000000,
      });

      // no command
      expect(parseCommandInput("")).toEqual(undefined);

      // only quantity
      expect(parseCommandInput("2")).toEqual(undefined);

      // invalid command
      expect(parseCommandInput("z")).toEqual(undefined);

      // invaid command with quantity
      expect(parseCommandInput("2z")).toEqual(undefined);
    });

    test("can parse modifier", () => {
      expect(parseCommandInput("_a")).toEqual({
        command: "a",
        quantity: 1,
        modifier: "_",
      });

      expect(parseCommandInput("-a")).toEqual({
        command: "a",
        quantity: 1,
        modifier: "-",
      });

      expect(parseCommandInput("2-a")).toEqual({
        command: "a",
        quantity: 2,
        modifier: "-",
      });
    });
  });
});

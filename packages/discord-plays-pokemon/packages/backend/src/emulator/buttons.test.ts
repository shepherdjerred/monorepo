import { commandToButtonMask } from "./buttons.ts";
import { BUTTON } from "./constants.ts";

describe("commandToButtonMask", () => {
  test("maps face and menu buttons", () => {
    expect(commandToButtonMask("a")).toBe(BUTTON.a);
    expect(commandToButtonMask("b")).toBe(BUTTON.b);
    expect(commandToButtonMask("start")).toBe(BUTTON.start);
    expect(commandToButtonMask("select")).toBe(BUTTON.select);
  });

  test("maps the d-pad, including l/r left-right aliases", () => {
    expect(commandToButtonMask("up")).toBe(BUTTON.up);
    expect(commandToButtonMask("down")).toBe(BUTTON.down);
    expect(commandToButtonMask("left")).toBe(BUTTON.left);
    expect(commandToButtonMask("right")).toBe(BUTTON.right);
    // In this grammar `l`/`r` are left/right, not the shoulder buttons.
    expect(commandToButtonMask("l")).toBe(BUTTON.left);
    expect(commandToButtonMask("r")).toBe(BUTTON.right);
  });
});

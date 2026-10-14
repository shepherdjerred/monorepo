import {
  neutralController,
  type ControllerState,
} from "@arcade/common/protocol.ts";

type Button = ControllerState["buttons"][number];
const buttons: Readonly<Partial<Record<Button, string>>> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  z: "Z",
  l: "L",
  r: "R",
  start: "START",
  up: "D_UP",
  down: "D_DOWN",
  left: "D_LEFT",
  right: "D_RIGHT",
};
export function dolphinInput(state: ControllerState): string {
  const held = new Set(state.buttons);
  if (state.triggerL >= 0.95) held.add("l");
  if (state.triggerR >= 0.95) held.add("r");
  const lines = Object.entries(buttons).map(
    ([name, token]) =>
      `${new Set<string>(held).has(name) ? "PRESS" : "RELEASE"} ${token}`,
  );
  lines.push(
    `SET MAIN ${String((state.stickX + 1) / 2)} ${String((state.stickY + 1) / 2)}`,
    `SET C ${String((state.cStickX + 1) / 2)} ${String((state.cStickY + 1) / 2)}`,
    `SET L ${String(state.triggerL)}`,
    `SET R ${String(state.triggerR)}`,
  );
  return lines.join("\n") + "\n";
}

/** Coalesce analog updates and retain short button presses for two CPU frames. */
export class DolphinPads {
  private frame = 0;
  private readonly requested: ControllerState[] = [
    neutralController,
    neutralController,
    neutralController,
    neutralController,
  ];
  private readonly until: Map<Button, number>[] = [
    new Map<Button, number>(),
    new Map<Button, number>(),
    new Map<Button, number>(),
    new Map<Button, number>(),
  ];

  constructor(
    private readonly write: (seat: number, message: string) => void,
  ) {}

  set(seat: number, state: ControllerState): void {
    const previous = this.requested[seat];
    const until = this.until[seat];
    if (previous === undefined || until === undefined)
      throw new Error("Invalid Dolphin controller port");
    for (const button of state.buttons)
      if (!previous.buttons.includes(button)) until.set(button, this.frame + 2);
    this.requested[seat] = state;
  }
  clear(seat: number): void {
    const until = this.until[seat];
    if (until === undefined) throw new Error("Invalid Dolphin controller port");
    until.clear();
    this.requested[seat] = neutralController;
    this.write(seat, dolphinInput(neutralController));
  }
  tick(): void {
    for (const [seat, state] of this.requested.entries()) {
      const until = this.until[seat];
      if (until === undefined)
        throw new Error("Invalid Dolphin controller latch");
      const held = new Set(state.buttons);
      for (const [button, deadline] of until)
        if (this.frame < deadline) held.add(button);
        else until.delete(button);
      this.write(seat, dolphinInput({ ...state, buttons: [...held] }));
    }
    this.frame++;
  }
}

export function dolphinControllers(): string {
  return (
    Array.from({ length: 4 }, (_unused, seat) => {
      const lines = [
        `[GCPad${String(seat + 1)}]`,
        `Device = Pipe/0/arcade-seat${String(seat)}`,
      ];
      for (const button of ["A", "B", "X", "Y", "Z", "Start"])
        lines.push(`Buttons/${button} = \`Button ${button.toUpperCase()}\``);
      for (const [direction, axis] of [
        ["Up", "Y +"],
        ["Down", "Y -"],
        ["Left", "X -"],
        ["Right", "X +"],
      ] as const) {
        lines.push(
          `Main Stick/${direction} = \`Axis MAIN ${axis}\``,
          `C-Stick/${direction} = \`Axis C ${axis}\``,
          `D-Pad/${direction} = \`Button D_${direction.toUpperCase()}\``,
        );
      }
      for (const side of ["L", "R"])
        lines.push(
          `Triggers/${side} = \`Button ${side}\``,
          `Triggers/${side}-Analog = \`Axis ${side} +\``,
        );
      return lines.join("\n");
    }).join("\n") + "\n"
  );
}

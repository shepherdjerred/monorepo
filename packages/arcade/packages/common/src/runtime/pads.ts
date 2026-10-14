import type { CubePad } from "./input.ts";
import { gameModule } from "./probe.ts";

function centered(seat: number): CubePad {
  return {
    seat,
    buttons: 0,
    stickX: 0,
    stickY: 0,
    cStickX: 0,
    cStickY: 0,
    triggerL: 0,
    triggerR: 0,
    clear: true,
  };
}

/** Preserve very short button taps, while authoritative seat resets clear immediately. */
export class BrowserPads {
  private readonly requested = [
    centered(0),
    centered(1),
    centered(2),
    centered(3),
  ];
  private readonly until = [
    new Uint32Array(16),
    new Uint32Array(16),
    new Uint32Array(16),
    new Uint32Array(16),
  ];
  private frame = 0;

  set(pad: CubePad): void {
    const previous = this.requested[pad.seat];
    const until = this.until[pad.seat];
    if (previous === undefined || until === undefined)
      throw new Error("Invalid controller port");
    if (pad.clear) until.fill(0);
    else
      for (let bit = 0; bit < 16; bit++)
        if (
          (pad.buttons & (1 << bit)) !== 0 &&
          (previous.buttons & (1 << bit)) === 0
        )
          until[bit] = this.frame + 2;
    this.requested[pad.seat] = pad;
  }

  apply(gameId: "mkwii" | "melee", frame: number): void {
    this.frame = frame;
    const module = gameModule();
    const pads = this.requested.map((pad, seat) => {
      const until = this.until[seat];
      if (until === undefined) throw new Error("Invalid controller state");
      let buttons = pad.buttons;
      for (let bit = 0; bit < 16; bit++)
        if (frame < (until[bit] ?? 0)) buttons |= 1 << bit;
      return [
        buttons,
        pad.stickX,
        pad.stickY,
        pad.cStickX,
        pad.cStickY,
        pad.triggerL,
        pad.triggerR,
      ] as const;
    });
    if (gameId === "mkwii") {
      module.arcadePads = pads;
      return;
    }
    const set = module._direct_set_pad;
    if (set === undefined)
      throw new Error("Melee assets are missing controller exports");
    for (const [port, pad] of pads.entries())
      set(port, pad[0], pad[1], pad[2], pad[3], pad[4], pad[5], pad[6], 1);
  }
}

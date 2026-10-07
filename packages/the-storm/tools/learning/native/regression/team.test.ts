import { describe, expect, it } from "vitest";
import { nativeTeam, teamMovement } from "./team-gate.ts";
import { teamFixture } from "./team-fixture.ts";

type Fixture = ReturnType<typeof teamFixture>;
const text = (rows: string[][]) =>
  rows.map((row) => row.join("\t")).join("\n") + "\n";
const findRow = (value: Fixture, tag: string) => {
  const found = value.rows.find((item) => item[0] === tag);
  if (found === undefined) throw new Error("Synthetic team row missing");
  return found;
};

const floors: {
  name: string;
  edit: (row: string[], member: number, tick: number) => void;
}[] = [
  {
    name: "spacing",
    edit: (row, member) => {
      row[5] = (
        (Math.floor(member / 2) === 7 ? 28 : Math.floor(member / 2) * 2) * 32
      ).toString();
    },
  },
  {
    name: "width-at-eight",
    edit: (row, member, tick) => {
      if (tick === 160)
        row[5] = Math.round(
          ((Math.floor(member / 2) * 15) / 7) * 32,
        ).toString();
    },
  },
  {
    name: "width-at-contact",
    edit: (row, member, tick) => {
      if (tick === 220)
        row[5] = Math.round(
          ((Math.floor(member / 2) * 15) / 7) * 32,
        ).toString();
    },
  },
  {
    name: "advance",
    edit: (row, member) => {
      row[3] = (member % 2 === 0 ? 5 * 32 : 59 * 32).toString();
    },
  },
  {
    name: "winding",
    edit: (row, member, tick) => {
      if (tick >= 200) return;
      const delta = (tick % 40 < 20 ? tick % 20 : 20 - (tick % 20)) * 2;
      row[3] = ((member % 2 === 0 ? 4 + delta : 60 - delta) * 32).toString();
    },
  },
];

const mutations: { name: string; edit: (value: Fixture) => void }[] = [
  {
    name: "header",
    edit: (value) => {
      findRow(value, "H")[1] = "2";
    },
  },
  {
    name: "map",
    edit: (value) => {
      findRow(value, "H")[3] = "other";
    },
  },
  {
    name: "roster-body",
    edit: (value) => {
      findRow(value, "R")[1] = "p" + "f".repeat(16);
    },
  },
  {
    name: "roster-team",
    edit: (value) => {
      findRow(value, "R")[2] = "BLUE";
    },
  },
  {
    name: "bot",
    edit: (value) => {
      findRow(value, "R")[4] = "false";
    },
  },
  {
    name: "frame-loss",
    edit: (value) => {
      value.rows.splice(40, 1);
    },
  },
  {
    name: "frame-duplicate",
    edit: (value) => {
      value.rows.splice(17, 0, [...findRow(value, "F")]);
    },
  },
  {
    name: "frame-order",
    edit: (value) => {
      findRow(value, "F")[1] = "2";
    },
  },
  {
    name: "foreign-frame",
    edit: (value) => {
      findRow(value, "F")[2] = "p" + "f".repeat(16);
    },
  },
  {
    name: "frame-shape",
    edit: (value) => {
      findRow(value, "F").pop();
    },
  },
  {
    name: "frame-health",
    edit: (value) => {
      findRow(value, "F")[8] = "-1";
    },
  },
  {
    name: "frame-start",
    edit: (value) => {
      value.rows.splice(17, 16);
    },
  },
  {
    name: "frame-tail",
    edit: (value) => {
      value.rows.splice(-33, 32);
    },
  },
  {
    name: "death",
    edit: (value) => {
      value.rows.splice(17, 0, [
        "E",
        "0",
        "died",
        findRow(value, "F")[2] ?? "",
        "-",
      ]);
    },
  },
  {
    name: "contact",
    edit: (value) => {
      value.rows = value.rows.filter((item) => item[0] !== "I");
    },
  },
  {
    name: "ending-clock",
    edit: (value) => {
      findRow(value, "X")[1] = "299";
    },
  },
  {
    name: "ending-reason",
    edit: (value) => {
      findRow(value, "X")[3] = "STOPPED";
    },
  },
  {
    name: "extra-header",
    edit: (value) => {
      value.rows.splice(17, 0, [...findRow(value, "H")]);
    },
  },
  {
    name: "input",
    edit: (value) => {
      value.rows.splice(17, 0, ["N", "0", "player"]);
    },
  },
];

describe("original native team advancement", () => {
  it("replays both original journals and complete native trajectories", () => {
    const value = nativeTeam(teamFixture());
    expect(value.movement.nativeFloors).toEqual({
      bots: 16,
      minimum_spacing: 4,
      minimum_width_at_8: 28,
      minimum_width_at_contact: 28,
      minimum_forward: 1,
      maximum_winding: 1,
    });
    expect(value.movement.frames).toBe(16 * 151);
    expect(value.movement.contact).toBe(220);
    expect(value.measured.counts.applied).toBe(1);
  });

  it.each(floors)("rejects below-floor $name movement", ({ edit }) => {
    const value = teamFixture();
    let index = 0;
    for (const item of value.rows) {
      if (item[0] === "F") edit(item, index++ % 16, Number(item[1]));
    }
    expect(() => teamMovement(text(value.rows), value.context)).toThrow();
  });

  it.each(mutations)(
    "rejects incomplete or changed original $name",
    ({ edit }) => {
      const value = teamFixture();
      edit(value);
      expect(() => teamMovement(text(value.rows), value.context)).toThrow();
    },
  );

  it("rejects a truncated original stream", () => {
    const value = teamFixture();
    expect(() =>
      teamMovement(value.recording.trimEnd(), value.context),
    ).toThrow();
  });

  it.each([
    "native-request",
    "native-checkpoint",
    "native-phase",
    "native-roster",
    "journal-loss",
    "stopped",
    "attack-clock",
  ])("rejects changed original %s evidence", (edit) => {
    const value = teamFixture();
    const live = value.native[1];
    const final = value.commands[3];
    if (live === undefined || final === undefined)
      throw new Error("Synthetic team requests missing");
    if (edit === "native-request") live.command = "rwf admin showcase 16";
    if (edit === "native-checkpoint") live.startSequence = 2;
    if (edit === "native-phase") live.endPhase = "LOBBY";
    if (edit === "native-roster") live.response = "0 humans, 15 bots";
    if (edit === "journal-loss") final.state.ticks.splice(1, 1);
    if (edit === "attack-clock")
      value.recording = value.recording.replace("I\t220\t", "I\t218\t");
    if (edit === "stopped") {
      const end = final.state.transitions[0];
      if (end === undefined) throw new Error("Synthetic team ending missing");
      end.event = "Stop";
    }
    expect(() => nativeTeam(value)).toThrow();
  });
});

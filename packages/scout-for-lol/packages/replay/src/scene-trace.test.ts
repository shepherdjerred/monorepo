import { describe, expect, it } from "vitest";
import {
  parseReplaySceneTrace,
  sampleReplayScene,
  type ReplaySceneTrace,
} from "./scene-trace.ts";

const actor = {
  participantId: 0,
  x: 100,
  y: 50,
  visibleTo: ["blue"],
} satisfies ReplaySceneTrace["frames"][number]["actors"][number];

function traceInput(): ReplaySceneTrace {
  return {
    durationSeconds: 10,
    width: 100,
    height: 50,
    participants: [
      { participantId: 0, name: "", championName: "Example", teamId: 100 },
      { participantId: 1, name: "Second", championName: "Other", teamId: 200 },
    ],
    frames: [
      { timeSeconds: 0, actors: [actor], directedParticipantId: 0 },
      {
        timeSeconds: 4,
        actors: [{ ...actor, x: 80, visibleTo: [] }],
        directedParticipantId: null,
      },
      { timeSeconds: 10, actors: [], directedParticipantId: null },
    ],
  };
}

describe("normalized replay scenes", () => {
  it("selects recorded frames at their exact times and clamps at the endpoints", () => {
    const trace = parseReplaySceneTrace(traceInput());
    expect(sampleReplayScene(trace, -10).timeSeconds).toBe(0);
    expect(sampleReplayScene(trace, 3.9).actors[0]?.x).toBe(100);
    expect(sampleReplayScene(trace, 4).actors[0]?.x).toBe(80);
    expect(sampleReplayScene(trace, 9.9).timeSeconds).toBe(4);
    expect(sampleReplayScene(trace, 10).timeSeconds).toBe(10);
    expect(sampleReplayScene(trace, Infinity).timeSeconds).toBe(10);
    expect(() => sampleReplayScene(trace, NaN)).toThrow(RangeError);
  });

  it("returns an empty frame in exact mode between or outside observed times", () => {
    const trace = parseReplaySceneTrace(traceInput());
    expect(sampleReplayScene(trace, 4, "exact").actors[0]?.x).toBe(80);
    for (const timeSeconds of [-1, 3.999999, 4.000001, 11]) {
      expect(sampleReplayScene(trace, timeSeconds, "exact")).toEqual({
        timeSeconds,
        actors: [],
        directedParticipantId: null,
      });
    }
    expect(sampleReplayScene(trace, 4.000001).actors[0]?.x).toBe(80);
  });

  it("rejects invalid dimensions, boundaries, and repeated times", () => {
    const trace = traceInput();
    expect(() => parseReplaySceneTrace({ ...trace, width: 0 })).toThrow();
    expect(() =>
      parseReplaySceneTrace({ ...trace, durationSeconds: 11 }),
    ).toThrow();
    expect(() => parseReplaySceneTrace({ ...trace, frames: [] })).toThrow();
    trace.frames[0].timeSeconds = 1;
    expect(() => parseReplaySceneTrace(trace)).toThrow(/start at zero/);
    trace.frames[0].timeSeconds = 0;
    trace.frames.splice(1, 0, trace.frames[0]);
    expect(() => parseReplaySceneTrace(trace)).toThrow(/increase strictly/);
  });

  it("rejects duplicate participants, invalid actors, and absent camera targets", () => {
    const trace = traceInput();
    expect(() =>
      parseReplaySceneTrace({
        ...trace,
        participants: [...trace.participants, trace.participants[0]],
      }),
    ).toThrow();
    trace.frames[0].actors = [actor, actor];
    expect(() => parseReplaySceneTrace(trace)).toThrow(
      /distinct trace participant/,
    );
    trace.frames[0].actors = [{ ...actor, participantId: 9 }];
    expect(() => parseReplaySceneTrace(trace)).toThrow(
      /distinct trace participant/,
    );
    trace.frames[0].actors = [{ ...actor, y: 50.1 }];
    expect(() => parseReplaySceneTrace(trace)).toThrow(/scene bounds/);
    trace.frames[0].actors = [actor];
    trace.frames[0].directedParticipantId = 1;
    expect(() => parseReplaySceneTrace(trace)).toThrow(/actor in this frame/);
  });
});

import { expect, test } from "vitest";
import { frozenPlaybackRow } from "./frozen-playback.ts";

function row() {
  return {
    id: 4,
    user_id: 7,
    rating_key: 99,
    started: 1000,
    stopped: 1180,
    paused_counter: 30,
    view_offset: 85_000,
    metadata_duration: 100_000,
    full_title: "Genuine source title",
    grandparent_title: null,
    media_type: "movie",
    live: 0,
    platform: "Infuse",
    player: "Living room",
    transcode_decision: "direct play",
  };
}
test("frozen history uses genuine stored pause time/offset/runtime and retains native source IDs", () => {
  expect(frozenPlaybackRow(row())).toEqual({
    id: "4",
    user_id: "7",
    rating_key: "99",
    started: 1000,
    stopped: 1180,
    duration: 150,
    percent_complete: 85,
    full_title: "Genuine source title",
    grandparent_title: null,
    media_type: "movie",
    platform: "Infuse",
    player: "Living room",
    transcode_decision: "direct_play",
  });
});
test("frozen capture follows source reporting semantics for null/zero runtime, live rows and even rounding", () => {
  expect(
    frozenPlaybackRow({ ...row(), metadata_duration: 0 }).percent_complete,
  ).toBe(0);
  expect(
    frozenPlaybackRow({ ...row(), view_offset: 84_500 }).percent_complete,
  ).toBe(84);
  expect(
    frozenPlaybackRow({ ...row(), view_offset: 85_500 }).percent_complete,
  ).toBe(86);
  expect(
    frozenPlaybackRow({
      ...row(),
      view_offset: null,
      metadata_duration: 0,
      live: 1,
    }).percent_complete,
  ).toBe(100);
});
test("a corrupt or incomplete historical source row is rejected rather than omitted or approximated", () => {
  expect(() => frozenPlaybackRow({ ...row(), full_title: null })).toThrow();
  expect(() => frozenPlaybackRow({ ...row(), paused_counter: 181 })).toThrow();
  expect(() => frozenPlaybackRow({ ...row(), stopped: 0 })).toThrow();
});

import { describe, expect, test } from "vitest";
import { excludeBaseline, parsePids } from "./verify-launch.ts";

describe("pgrep output parsing", () => {
  test("parses one pid per line", () => {
    expect(parsePids("123\n456\n")).toEqual([123, 456]);
  });

  test("ignores blank lines", () => {
    expect(parsePids("\n123\n\n")).toEqual([123]);
  });

  test("ignores malformed lines and non-positive pids", () => {
    expect(parsePids("123\nnope\n0\n-4\n  789  \n")).toEqual([123, 789]);
  });

  test("empty output means no copies running", () => {
    expect(parsePids("")).toEqual([]);
  });
});

describe("baseline attribution", () => {
  test("a fresh launch with no baseline keeps every pid", () => {
    expect(excludeBaseline([123, 456], new Set())).toEqual([123, 456]);
  });

  test("a stale copy from a canceled run is ignored, the new copy is kept", () => {
    expect(excludeBaseline([111, 222], new Set([111]))).toEqual([222]);
  });

  test("when only the stale copy runs, nothing counts as ours", () => {
    expect(excludeBaseline([111], new Set([111]))).toEqual([]);
  });

  test("a stale copy that exited on its own leaves the run unblocked", () => {
    expect(excludeBaseline([222], new Set([111]))).toEqual([222]);
  });
});

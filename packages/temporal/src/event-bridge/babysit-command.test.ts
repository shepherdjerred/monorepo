import { describe, expect, test } from "bun:test";
import { parseBabysitCommand } from "./babysit-command.ts";

const H = "@temporal-worker";

describe("parseBabysitCommand", () => {
  test("handle + help + goal → start with instruction", () => {
    expect(parseBabysitCommand(`${H} help me get this green`, H)).toEqual({
      kind: "start",
      instruction: "me get this green",
    });
  });
  test("handle + babysit → start", () => {
    expect(parseBabysitCommand(`${H} babysit`, H)).toEqual({ kind: "start" });
  });
  test("handle alone → start", () => {
    expect(parseBabysitCommand(`  ${H}  `, H)).toEqual({ kind: "start" });
  });
  test("handle + stop → stop (not forced)", () => {
    expect(parseBabysitCommand(`${H} stop`, H)).toEqual({
      kind: "stop",
      force: false,
    });
  });
  test("handle + stop force → forced stop", () => {
    expect(parseBabysitCommand(`${H} stop force please`, H)).toEqual({
      kind: "stop",
      force: true,
    });
  });
  test("handle + status → status", () => {
    expect(parseBabysitCommand(`${H} status`, H)).toEqual({ kind: "status" });
  });
  test("handle + unknown verb → start with whole remainder as goal", () => {
    expect(parseBabysitCommand(`${H} please fix the lint`, H)).toEqual({
      kind: "start",
      instruction: "please fix the lint",
    });
  });
  test("case-insensitive handle", () => {
    expect(parseBabysitCommand(`@Temporal-Worker STATUS`, H)).toEqual({
      kind: "status",
    });
  });
  test("handle not first token → none (no mid-sentence trigger)", () => {
    expect(parseBabysitCommand(`hey ${H} babysit`, H)).toEqual({
      kind: "none",
    });
  });
  test("no handle → none", () => {
    expect(parseBabysitCommand("just a normal comment", H)).toEqual({
      kind: "none",
    });
  });
  test("empty → none", () => {
    expect(parseBabysitCommand("", H)).toEqual({ kind: "none" });
  });
});

import { describe, expect, test } from "bun:test";
import {
  parseCommand,
  resolvePlayQuery,
} from "@shepherdjerred/streambot/discord/command.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";

describe("parseCommand", () => {
  test("ignores messages without the prefix", () => {
    expect(parseCommand("play something", "$")).toBeNull();
    expect(parseCommand("hello", "$")).toBeNull();
  });

  test("parses play with its argument and aliases", () => {
    expect(parseCommand("$play Black Swan", "$")).toEqual({
      type: "play",
      query: "Black Swan",
    });
    expect(parseCommand("$p https://youtu.be/x", "$")).toEqual({
      type: "play",
      query: "https://youtu.be/x",
    });
  });

  test("requires an argument for play and search", () => {
    expect(parseCommand("$play", "$")).toBeNull();
    expect(parseCommand("$search   ", "$")).toBeNull();
  });

  test("parses argument-less commands and aliases", () => {
    expect(parseCommand("$skip", "$")).toEqual({ type: "skip" });
    expect(parseCommand("$next", "$")).toEqual({ type: "skip" });
    expect(parseCommand("$stop", "$")).toEqual({ type: "stop" });
    expect(parseCommand("$status", "$")).toEqual({ type: "status" });
  });

  test("list takes an optional filter", () => {
    expect(parseCommand("$list", "$")).toEqual({ type: "list", query: null });
    expect(parseCommand("$list marvel", "$")).toEqual({
      type: "list",
      query: "marvel",
    });
  });

  test("returns null for unknown commands", () => {
    expect(parseCommand("$frobnicate", "$")).toBeNull();
  });

  test("honours a custom prefix", () => {
    expect(parseCommand("!skip", "!")).toEqual({ type: "skip" });
  });
});

describe("resolvePlayQuery", () => {
  const entries: LibraryEntry[] = [
    {
      title: "Black Swan",
      path: "/media/movies/Black Swan/Black Swan.mkv",
      relativePath: "Black Swan/Black Swan.mkv",
      library: "movies",
    },
  ];

  test("prefers a local library match", () => {
    expect(resolvePlayQuery("black swan", entries)).toEqual({
      kind: "file",
      path: "/media/movies/Black Swan/Black Swan.mkv",
      title: "Black Swan",
    });
  });

  test("treats an http(s) url as a url source", () => {
    expect(resolvePlayQuery("https://youtu.be/abc", entries)).toEqual({
      kind: "url",
      url: "https://youtu.be/abc",
    });
  });

  test("falls back to a search source", () => {
    expect(resolvePlayQuery("never gonna give you up", entries)).toEqual({
      kind: "search",
      query: "never gonna give you up",
    });
  });
});

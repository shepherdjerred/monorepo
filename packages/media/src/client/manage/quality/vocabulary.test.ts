import { expect, test } from "vitest";
import { parseReleaseName } from "#domain/release-parser.ts";
import {
  CODEC_SUGGESTIONS,
  LANGUAGE_SUGGESTIONS,
  QUALITY_SUGGESTIONS,
  TRAITS,
} from "./vocabulary.ts";

/** A release name the parser reads each suggested word out of. */
const SOURCE_WORDS: Readonly<Record<string, string>> = {
  Remux: "REMUX",
  Bluray: "BluRay",
  WEB: "WEB-DL",
  WEBrip: "WEBRip",
  HDTV: "HDTV",
};
const CODEC_WORDS: Readonly<Record<string, string>> = {
  HEVC: "x265",
  H264: "x264",
  AV1: "AV1",
  unknown: "",
};
const LANGUAGE_WORDS: Readonly<Record<string, string>> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
};
const TRAIT_WORDS: Readonly<Record<(typeof TRAITS)[number], string>> = {
  HDR: "HDR",
  "HDR10+": "HDR10+",
  DV: "DoVi",
  "DD+ATMOS": "DDP5.1.Atmos",
  TrueHD: "TrueHD",
  "DTS-X": "DTS-X",
  REPACK: "REPACK",
  PROPER: "PROPER",
};

function word(words: Readonly<Record<string, string>>, key: string): string {
  const found = words[key];
  if (found === undefined) throw new Error(`No sample word for ${key}`);
  return found;
}

test("every suggested quality is one the parser reads from a release name", () => {
  for (const { value } of QUALITY_SUGGESTIONS) {
    const [source = "", resolution = ""] = value.split("-");
    const name = `Some.Movie.2020.${resolution}.${word(SOURCE_WORDS, source)}.x264-GRP`;
    expect(parseReleaseName(name).quality, name).toBe(value);
  }
});

test("every suggested codec and language is one the parser reads", () => {
  for (const { value } of CODEC_SUGGESTIONS) {
    const name = `Some.Movie.2020.1080p.WEB-DL.${word(CODEC_WORDS, value)}-GRP`;
    expect(parseReleaseName(name).codec, name).toBe(value);
  }
  for (const { value } of LANGUAGE_SUGGESTIONS) {
    const name = `Some.Movie.2020.1080p.WEB-DL.${word(LANGUAGE_WORDS, value)}.x264-GRP`;
    expect(parseReleaseName(name).audioLanguages, name).toEqual([value]);
  }
});

test("every listed trait, and the release group, is a score tag the parser emits", () => {
  for (const trait of TRAITS) {
    const name = `Some.Movie.2020.1080p.WEB-DL ${TRAIT_WORDS[trait]} x264-GRP`;
    expect(parseReleaseName(name).scoreTags, name).toContain(trait);
  }
  expect(
    parseReleaseName("Some.Movie.2020.1080p.WEB-DL.x264-GRP").scoreTags,
  ).toContain("group:GRP");
});

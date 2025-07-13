import { randomUUID } from "crypto";
import * as Factory from "factory.ts";
import {
  doesNoVideoMatch,
  doVideosMatch,
  filterNewVideos,
} from "./newVideoFinder";
import * as randomWords from "random-words";
import { Video } from "../schema/schema";

const videoFactory = Factory.Sync.makeFactory<Video>({
  releaseDate: Factory.Sync.each(() => new Date()),
  title: Factory.each(() => randomWords(3).join(" ")),
  uuid: Factory.each(() => randomUUID()),
  url: "",
  thumbnail: "",
});

describe("doVideosMatch", () => {
  it("returns true for identical videos", () => {
    const left = videoFactory.build();
    const right = {
      ...left,
    };
    const result = doVideosMatch(left, right);
    expect(result).toBe(true);
  });

  it("returns false for different videos", () => {
    const left = videoFactory.build();
    const right = {
      ...left,
      uuid: "this uuid will never collide",
    };
    const result = doVideosMatch(left, right);
    expect(result).toBe(false);
  });
});

describe("doesNoVideoMatch", () => {
  it("returns false when one video matches", () => {
    const target = videoFactory.build();
    const videos = [...videoFactory.buildList(3), target];
    const result = doesNoVideoMatch(target, videos);
    expect(result).toBe(false);
  });

  it("returns true when no video matches", () => {
    const target = videoFactory.build();
    const videos = videoFactory.buildList(3);
    const result = doesNoVideoMatch(target, videos);
    expect(result).toBe(true);
  });
});

describe("filterNewVideos", () => {
  it("returns nothing when there are no new videos", () => {
    const currentVideos = videoFactory.buildList(2);
    const previousVideos = currentVideos;
    const newVideos = filterNewVideos(currentVideos, previousVideos);
    expect(newVideos).toStrictEqual([]);
  });

  it("returns nothing when there are videos present in previous that are missing from current", () => {
    const currentVideos = videoFactory.buildList(2);
    const previousVideos = [...currentVideos, ...videoFactory.buildList(2)];
    const newVideos = filterNewVideos(currentVideos, previousVideos);
    expect(newVideos).toStrictEqual([]);
  });

  it("returns new videos", () => {
    const currentVideos = videoFactory.buildList(2);
    const previousVideos: Video[] = [];
    const newVideos = filterNewVideos(currentVideos, previousVideos);
    expect(newVideos).toStrictEqual(currentVideos);
  });
});

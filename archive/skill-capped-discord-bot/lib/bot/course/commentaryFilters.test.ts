import {
  isValorantCommentaryCourse,
  isWorldOfWarcraftCommentaryCourse,
} from "./commentaryFilters";
import { Course } from "../schema/schema";

describe("commentaryFilter", () => {
  describe("isWorldOfWarcraftCommentaryCourse", () => {
    it("returns true for a commentary course", () => {
      const course: Course = {
        title: "ROGUE ARENA GUIDES",
        uuid: "",
        videos: [],
      };
      const actual = isWorldOfWarcraftCommentaryCourse(course);
      expect(actual).toBe(true);
    });

    it("returns false for a regular course", () => {
      const course: Course = {
        title: "Some random course",
        uuid: "",
        videos: [],
      };
      const actual = isWorldOfWarcraftCommentaryCourse(course);
      expect(actual).toBe(false);
    });
  });

  describe("isValorantCommentaryCourse", () => {
    it("returns false", () => {
      const course: Course = {
        title: "Some random course",
        uuid: "",
        videos: [],
      };
      const actual = isValorantCommentaryCourse(course);
      expect(actual).toBe(false);
    });
  });
});

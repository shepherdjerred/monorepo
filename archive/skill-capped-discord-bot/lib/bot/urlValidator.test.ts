import { isUrlValid } from "./urlValidator";

describe("urlValidtor", () => {
  describe("isUrlValid", () => {
    it("should return true for google.com", async () => {
      const actual = await isUrlValid("https://google.com");
      expect(actual).toBe(true);
    });

    it("should return false for an unreachable url", async () => {
      const actual = await isUrlValid(
        "https://google.com/this/url/should/not/exist"
      );
      expect(actual).toBe(false);
    });
  });
});

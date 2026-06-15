import { StaticManifestFetcher } from "./manifest/staticManifestFetcher";
import { DiscordNotifier } from "./notification/discord/discordNotifier";
import { FunctionNotifier } from "./notification/functionNotifier";
import { Processor } from "./processor";
import Site from "./site";
import { SiteFetcherStorage } from "./storage/siteFetcherStorage";
import { FilteringNotifier } from "./notification/filter/FilteringNotifier";
jest.mock("./notification/nullNotifier");

describe("processor", () => {
  it("arguments passed to notifier should match snapshot for league of legends", async () => {
    const previousFetcher = new StaticManifestFetcher("previous");
    const previousStorage = new SiteFetcherStorage(previousFetcher, true);
    const currentFetcher = new StaticManifestFetcher("current");
    const currentStorage = new SiteFetcherStorage(currentFetcher, true);
    const mockFn = jest.fn();
    const notifier = new FunctionNotifier(mockFn);
    const processor = new Processor(previousStorage, currentStorage, notifier);
    await processor.process(Site.LEAGUE_OF_LEGENDS);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mockFnArg = mockFn.mock.calls[0];
    expect(mockFnArg).toMatchSnapshot("videos and commentaries match");
  });
  it("arguments passed to notifier should match snapshot for world of warcraft", async () => {
    const previousFetcher = new StaticManifestFetcher("previous");
    const previousStorage = new SiteFetcherStorage(previousFetcher, true);
    const currentFetcher = new StaticManifestFetcher("current");
    const currentStorage = new SiteFetcherStorage(currentFetcher, true);
    const mockFn = jest.fn();
    const notifier = new FunctionNotifier(mockFn);
    const processor = new Processor(previousStorage, currentStorage, notifier);
    await processor.process(Site.WORLD_OF_WARCRAFT);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mockFnArg = mockFn.mock.calls[0];
    expect(mockFnArg).toMatchSnapshot("videos and commentaries match");
  });
  it("arguments passed to notifier should match snapshot for valorant", async () => {
    const previousFetcher = new StaticManifestFetcher("previous");
    const previousStorage = new SiteFetcherStorage(previousFetcher, true);
    const currentFetcher = new StaticManifestFetcher("current");
    const currentStorage = new SiteFetcherStorage(currentFetcher, true);
    const mockFn = jest.fn();
    const notifier = new FunctionNotifier(mockFn);
    const processor = new Processor(previousStorage, currentStorage, notifier);
    await processor.process(Site.VALORANT);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mockFnArg = mockFn.mock.calls[0];
    expect(mockFnArg).toMatchSnapshot("videos and commentaries match");
  });

  describe("end-to-end", () => {
    // eslint-disable-next-line jest/expect-expect
    it("should work for league of legends", async () => {
      const previousFetcher = new StaticManifestFetcher("previous");
      const previousStorage = new SiteFetcherStorage(previousFetcher, true);
      const currentFetcher = new StaticManifestFetcher("current");
      const currentStorage = new SiteFetcherStorage(currentFetcher, true);
      const discordCommentaryNotifier = new DiscordNotifier(
        "OTUwMTM1MTc5MzE2NDQ5Mjgw.YiUgVw.o-UrcIbNDbw4734w6JIuXNGLxhM",
        "970449461191000124",
      );
      const commentaryNotifier = new FilteringNotifier(
        {
          sendVideos: false,
          sendCommentaries: true,
        },
        discordCommentaryNotifier,
      );
      const commentaryProcessor = new Processor(
        previousStorage,
        currentStorage,
        commentaryNotifier,
      );
      await commentaryProcessor.process(Site.LEAGUE_OF_LEGENDS);

      const discordVideoNotifier = new DiscordNotifier(
        "OTUwMTM1MTc5MzE2NDQ5Mjgw.YiUgVw.o-UrcIbNDbw4734w6JIuXNGLxhM",
        "970441366637264927",
      );
      const videoNotifier = new FilteringNotifier(
        { sendVideos: true, sendCommentaries: false },
        discordVideoNotifier,
      );
      const videoProcessor = new Processor(
        previousStorage,
        currentStorage,
        videoNotifier,
      );
      await videoProcessor.process(Site.LEAGUE_OF_LEGENDS);
    });
    // eslint-disable-next-line jest/expect-expect
    it("should work for world of warcraft", async () => {
      const previousFetcher = new StaticManifestFetcher("previous");
      const previousStorage = new SiteFetcherStorage(previousFetcher, true);
      const currentFetcher = new StaticManifestFetcher("current");
      const currentStorage = new SiteFetcherStorage(currentFetcher, true);
      const discordNotifier = new DiscordNotifier(
        "OTUwMTM1MTc5MzE2NDQ5Mjgw.YiUgVw.o-UrcIbNDbw4734w6JIuXNGLxhM",
        "970441349742624782",
      );
      const notifier = new FilteringNotifier(
        {
          sendVideos: false,
          sendCommentaries: true,
        },
        discordNotifier,
      );
      const processor = new Processor(
        previousStorage,
        currentStorage,
        notifier,
      );
      await processor.process(Site.WORLD_OF_WARCRAFT);
    });
    // eslint-disable-next-line jest/expect-expect
    it("should work for valorant", async () => {
      const previousFetcher = new StaticManifestFetcher("previous");
      const previousStorage = new SiteFetcherStorage(previousFetcher, true);
      const currentFetcher = new StaticManifestFetcher("current");
      const currentStorage = new SiteFetcherStorage(currentFetcher, true);
      const discordNotifier = new DiscordNotifier(
        "OTUwMTM1MTc5MzE2NDQ5Mjgw.YiUgVw.o-UrcIbNDbw4734w6JIuXNGLxhM",
        "970441319094845541",
      );
      const notifier = new FilteringNotifier(
        {
          sendVideos: false,
          sendCommentaries: true,
        },
        discordNotifier,
      );
      const processor = new Processor(
        previousStorage,
        currentStorage,
        notifier,
      );
      await processor.process(Site.VALORANT);
    });
  });
});

import { z } from "zod";
import recorded from "./fixtures/youtube-music.json" with { type: "json" };
import { YouTubeMusicProvider } from "@shepherdjerred/streambot/music/youtube-music.ts";

/**
 * Responses recorded once from the live YouTube Music API (searches for "get lucky", "daft punk"
 * and the misspelling "bohemian rapsody", the album "Random Access Memories", the artist "Daft
 * Punk", and typeahead for "get lu"). They were captured through a recording `fetch`, then reduced:
 * tracking and session parameters, menus and accessibility text dropped, each shelf cut to three
 * items. Nothing in them identifies a person. They run through the real `youtubei.js` parser, so a
 * parser or schema change that breaks the adapter fails here without any network.
 */
export type RecordedResponses = Record<string, unknown>;

export const SONG_SEARCH = "search|get lucky|EgWKAQIIAQ%3D%3D";
export const VIDEO_SEARCH = "search|get lucky|EgWKAQIQAQ%3D%3D";
export const ALBUM_SEARCH = "search|daft punk|EgWKAQIYAQ%3D%3D";
export const ARTIST_SEARCH = "search|daft punk|EgWKAQIgAQ%3D%3D";
export const CORRECTED_SEARCH = "search|bohemian rapsody|EgWKAQIIAQ%3D%3D";
export const SUGGEST = "suggest|get lu";
export const ALBUM_ID = "MPREb_K8qWMWVqXGi";
export const ARTIST_ID = "UCRr1xG_2WIDs18a6cIiCxeA";

export function responses(): RecordedResponses {
  return structuredClone(recorded);
}

// `z.custom` hands back the same object, so a test can mutate a recording through these.
const RecordSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === "object" && value !== null,
);
const ListSchema = z.custom<unknown[]>((value) => Array.isArray(value));

const SHELF_PATH = [
  "contents",
  "tabbedSearchResultsRenderer",
  "tabs",
  "0",
  "tabRenderer",
  "content",
  "sectionListRenderer",
  "contents",
];

/**
 * The list of items in a search response's result shelf, by reference, so a test can damage a
 * recording the way an upstream change would.
 */
export function shelfItems(response: unknown): unknown[] {
  let node: unknown = response;
  for (const key of SHELF_PATH) node = RecordSchema.parse(node)[key];
  for (const section of ListSchema.parse(node)) {
    const shelf = RecordSchema.parse(section)["musicShelfRenderer"];
    if (shelf !== undefined)
      return ListSchema.parse(RecordSchema.parse(shelf)["contents"]);
  }
  throw new TypeError("The recorded response has no shelf");
}

/** Remove the video id from the chosen items (all by default), so they cannot validate. */
export function stripVideoIds(
  response: unknown,
  which?: readonly number[],
): void {
  for (const [index, item] of shelfItems(response).entries()) {
    if (which !== undefined && !which.includes(index)) continue;
    const renderer =
      RecordSchema.parse(item)["musicResponsiveListItemRenderer"];
    delete RecordSchema.parse(renderer)["playlistItemData"];
  }
}

/**
 * Credit an item to an artist who has no channel page: its second line becomes plain text, so the
 * client lists no artists, as it does for karaoke and uploader credits.
 */
export function creditAsPlainText(
  response: unknown,
  index: number,
  name: string,
): void {
  const item = RecordSchema.parse(shelfItems(response)[index]);
  const renderer = RecordSchema.parse(item["musicResponsiveListItemRenderer"]);
  const columns = ListSchema.parse(renderer["flexColumns"]);
  const column = RecordSchema.parse(
    RecordSchema.parse(columns[1])["musicResponsiveListItemFlexColumnRenderer"],
  );
  column["text"] = {
    runs: [{ text: name }, { text: " \u{2022} " }, { text: "5:41" }],
  };
}

export type ReplayCall = { readonly key: string };

const KIND_KEYS: Readonly<Record<string, string>> = {
  "EgWKAQIIAQ%3D%3D": SONG_SEARCH,
  "EgWKAQIQAQ%3D%3D": VIDEO_SEARCH,
  "EgWKAQIYAQ%3D%3D": ALBUM_SEARCH,
  "EgWKAQIgAQ%3D%3D": ARTIST_SEARCH,
};

export type ReplayOptions = {
  /** Answer any query of a kind with that kind's recording; for the local preview only. */
  readonly lenient?: boolean;
};

const RequestBodySchema = z.object({
  query: z.string().optional(),
  params: z.string().optional(),
  browseId: z.string().optional(),
  input: z.string().optional(),
});

/** The constructor overloads take a request or a URL, never the union, and no explicit undefined. */
function toRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Request {
  if (input instanceof Request)
    return init === undefined ? input : new Request(input, init);
  const url = input.toString();
  return init === undefined ? new Request(url) : new Request(url, init);
}

/** A `fetch` that answers from recorded responses and fails any request it has no recording for. */
export function replayFetch(
  data: RecordedResponses,
  calls: ReplayCall[] = [],
  options: ReplayOptions = {},
) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const request = toRequest(input, init);
    const fields = RequestBodySchema.parse(JSON.parse(await request.text()));
    const path = new URL(request.url).pathname;
    const params = fields.params ?? "";
    const exact = path.includes("/search")
      ? `search|${fields.query ?? ""}|${params}`
      : path.includes("/browse")
        ? `browse|${fields.browseId ?? ""}`
        : `suggest|${fields.input ?? ""}`;
    let key = exact;
    if (options.lenient === true) {
      if (path.includes("/search")) key = KIND_KEYS[params] ?? exact;
      else if (path.includes("/browse"))
        key = `browse|${fields.browseId?.startsWith("UC") === true ? ARTIST_ID : ALBUM_ID}`;
      else key = SUGGEST;
    }
    calls.push({ key });
    return key in data
      ? Response.json(data[key])
      : new Response("{}", { status: 404 });
  };
}

export function replayProvider(
  data: RecordedResponses = responses(),
  calls: ReplayCall[] = [],
  options: ReplayOptions = {},
) {
  return new YouTubeMusicProvider({
    fetch: replayFetch(data, calls, options),
    session: "local",
  });
}

/** A transport that never answers, for deadline and abort tests. */
export function neverAnswers(): Promise<Response> {
  return new Promise<Response>(() => {
    /* never settles */
  });
}

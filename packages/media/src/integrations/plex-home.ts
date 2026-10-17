import { load } from "cheerio";
import { z } from "zod";
import { IntegrationError, request, type FetchTransport } from "./http.ts";
import { boundedBytes } from "./providers.ts";

const HomeUserSchema = z.object({
  id: z.string().regex(/^[1-9]\d*$/u),
  title: z.string().min(1),
  restricted: z.enum(["0", "1"]).transform((value) => value === "1"),
  protected: z.enum(["0", "1"]).transform((value) => value === "1"),
});
export type PlexHomeUser = z.output<typeof HomeUserSchema>;

/** Protocol verified against Python-PlexAPI's Home-user source; never join by title. */
export class PlexHomeClient {
  constructor(
    private readonly token: string,
    private readonly transport: FetchTransport = fetch,
  ) {}

  async users(): Promise<PlexHomeUser[]> {
    const document = await this.xml(
      new URL("https://plex.tv/api/home/users"),
      "GET",
    );
    const $ = load(document, { xmlMode: true });
    const root = $("MediaContainer");
    const expected = z.coerce
      .number()
      .int()
      .nonnegative()
      .max(100)
      .parse(root.attr("size"));
    const users = root
      .children("User")
      .toArray()
      .map((element) => HomeUserSchema.parse($(element).attr()));
    if (
      users.length !== expected ||
      new Set(users.map((user) => user.id)).size !== users.length
    )
      throw new IntegrationError("plex-home", "invalid-response");
    return users;
  }

  async switchUser(id: string, pin?: string): Promise<string> {
    z.string()
      .regex(/^[1-9]\d*$/u)
      .parse(id);
    const url = new URL(`https://plex.tv/api/home/users/${id}/switch`);
    if (pin !== undefined)
      url.searchParams.set(
        "pin",
        z
          .string()
          .regex(/^\d{4}$/u)
          .parse(pin),
      );
    const document = await this.xml(url, "POST");
    const $ = load(document, { xmlMode: true });
    const user = $("user");
    const identity = user.attr("id");
    const token = user.attr("authenticationToken");
    if (identity !== id || token === undefined || token.length === 0)
      throw new IntegrationError("plex-home", "invalid-response");
    return token;
  }

  private async xml(url: URL, method: "GET" | "POST"): Promise<string> {
    const response = await request(this.transport, "plex-home", url, {
      method,
      mutation: method === "POST",
      headers: {
        "X-Plex-Token": this.token,
        "X-Plex-Client-Identifier": "media-home-profiles",
        Accept: "application/xml",
      },
    });
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedBytes(response, 256 * 1024, "plex-home"),
    );
  }
}

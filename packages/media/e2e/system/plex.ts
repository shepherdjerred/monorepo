import type { Database } from "#infrastructure/database.ts";
import { SYSTEM_MOVIE } from "#testing/system/external.ts";

/** Synthetic PMS wire boundary backed by the actual published asset records.
 * Real intended-build PMS compatibility is verified by the separate native lane.
 */
export function syntheticPlexWire(db: Database, serverMachineId: string) {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/identity")
      return Response.json({
        MediaContainer: { machineIdentifier: serverMachineId },
      });
    if (url.pathname === "/library/sections")
      return Response.json({
        MediaContainer: {
          size: 2,
          Directory: [
            { key: "1", type: "movie", title: "Synthetic movies" },
            { key: "2", type: "show", title: "Synthetic TV" },
          ],
        },
      });
    if (/^\/library\/sections\/[12]\/refresh$/.test(url.pathname))
      return new Response();
    if (url.pathname === "/status/sessions")
      return Response.json({ MediaContainer: { size: 0, Metadata: [] } });
    if (url.pathname === "/library/sections/2/all")
      return Response.json({
        MediaContainer: { size: 0, totalSize: 0, Metadata: [] },
      });
    if (
      url.pathname === "/library/sections/1/all" ||
      url.pathname === "/library/metadata/101"
    ) {
      const assets = await db.libraryAsset.findMany({
        where: { coverage: { some: { current: true } } },
      });
      const metadata = assets.map((asset, index) => ({
        ratingKey: String(101 + index),
        type: "movie",
        librarySectionID: 1,
        title: SYSTEM_MOVIE.title,
        year: 2020,
        Guid: [{ id: `tmdb://${String(SYSTEM_MOVIE.id)}` }],
        Media: [
          {
            Part: [
              {
                id: 201 + index,
                file: asset.path,
                size: Number(asset.sizeBytes),
              },
            ],
          },
        ],
      }));
      return Response.json({
        MediaContainer: {
          size: metadata.length,
          totalSize: metadata.length,
          Metadata: metadata,
        },
      });
    }
    return new Response("Unknown synthetic PMS route", { status: 404 });
  };
}

import { z } from "zod";
import { createDatabase, type Database } from "#infrastructure/database.ts";

/** Two real private pools exercise TIMESTAMP(3) comparisons in different
 * non-UTC sessions. No global/session SET or stored date rewrite is used. */
export async function nativeSeriesPackTimezonePoolsV1(privateUrl: string) {
  const clients: Database[] = [];
  const close = async () => {
    const outcomes = await Promise.allSettled(
      clients.map((db) => db.$disconnect()),
    );
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [z.unknown().parse(outcome.reason)] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        "Private native timezone pools did not close",
      );
  };
  const connect = async (timezone: string) => {
    const url = new URL(privateUrl);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/postgres")
      throw new Error(
        "Native timezone fixture requires its private PostgreSQL",
      );
    url.searchParams.set("options", `-c timezone=${timezone}`);
    const db = createDatabase(url.href);
    clients.push(db);
    const observed = z
      .array(z.strictObject({ timezone: z.string() }))
      .length(1)
      .parse(
        await db.$queryRaw`SELECT current_setting('TimeZone') AS timezone`,
      );
    if (observed[0]?.timezone !== timezone)
      throw new Error("Private native pool did not retain its actual timezone");
    return db;
  };
  try {
    const review = await connect("America/Los_Angeles");
    const serving = await connect("Asia/Tokyo");
    return { review, serving, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Native timezone pool setup failed",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

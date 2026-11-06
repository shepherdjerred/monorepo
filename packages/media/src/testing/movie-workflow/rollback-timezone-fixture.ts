import { z } from "zod";
import { createDatabase, type Database } from "#infrastructure/database.ts";
import { createRequestedMovieRollbackFileFacetV1 } from "#automation/files/movie-editions/rollback/manual-facet.ts";
import { createRequestedMovieRollbackNetworkFacetV1 } from "#automation/movie-editions/rollback/manual-facet.ts";
import { createManualMovieRollbackFixture } from "./manual-rollback-fixture.ts";
import {
  createOutboxActivities,
  type WorkflowStart,
} from "#automation/store.ts";

/** Separate real pool has startup TimeZone. Original rows and process/global
 * clocks remain unchanged; actual SDK producers use this pool throughout. */
export async function createMovieRollbackTimezoneFixture(
  timezone: "America/Los_Angeles" | "Asia/Tokyo",
  videos: { original: Uint8Array; upgrade: Uint8Array },
) {
  let fixture:
    Awaited<ReturnType<typeof createManualMovieRollbackFixture>> | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;
  try {
    fixture = await createManualMovieRollbackFixture(
      "extended_cut",
      videos,
      async (original) => {
        database = await localTimezoneDatabase(original, timezone);
        return database;
      },
    );
    const f = fixture;
    const db = database;
    if (db === undefined)
      throw new Error("Actual local-zone command database missing");
    const starts: WorkflowStart[] = [];
    return {
      ...f,
      db,
      starts,
      dispatch: () =>
        createOutboxActivities(db, (start) => {
          if (start.workflowId !== `media-operation-${f.input.operationId}`)
            return Promise.reject(
              new Error(
                "Unrelated actual operations remain for their own workers",
              ),
            );
          starts.push(start);
          return Promise.resolve();
        }).dispatchMediaOutbox(),
      manual: {
        ...createRequestedMovieRollbackFileFacetV1({ ...f.files, db }),
        ...createRequestedMovieRollbackNetworkFacetV1({ ...f.context, db }),
      },
      close: async () => {
        try {
          await db.$disconnect();
        } finally {
          await f.close();
        }
      },
    };
  } catch (error) {
    try {
      await database?.$disconnect();
    } finally {
      await fixture?.close();
    }
    throw error;
  }
}

async function localTimezoneDatabase(original: Database, timezone: string) {
  const [address] = z
    .array(
      z.strictObject({
        database: z.literal("postgres"),
        user: z.literal("media"),
        port: z.int().positive(),
      }),
    )
    .length(1)
    .parse(
      await original.$queryRaw`SELECT current_database() AS database,current_user AS "user",inet_server_port() AS port`,
    );
  if (address === undefined)
    throw new Error("Actual private PostgreSQL endpoint missing");
  const url = new URL(
    `postgresql://media@127.0.0.1:${String(address.port)}/postgres`,
  );
  url.searchParams.set("options", `-c timezone=${timezone}`);
  const db = createDatabase(url.toString());
  try {
    const [observed] = z
      .array(z.strictObject({ timezone: z.string() }))
      .length(1)
      .parse(
        await db.$queryRaw`SELECT current_setting('TimeZone') AS timezone`,
      );
    if (observed?.timezone !== timezone)
      throw new Error(
        "Actual private session did not use its requested TimeZone",
      );
    return db;
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
}

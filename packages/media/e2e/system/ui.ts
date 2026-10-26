import { serveStatic } from "hono/bun";
import type { createSystemHttpServer } from "#testing/system/http.ts";

/** Serve the actual built application over the same authenticated fixture API. */
export async function mountSystemUi(
  app: ReturnType<typeof createSystemHttpServer>["app"],
) {
  const root = new URL("../../dist/", import.meta.url).pathname;
  if (!(await Bun.file(`${root}index.html`).exists()))
    throw new Error("Build Media before requesting the mounted system UI");
  app.get("/assets/*", serveStatic({ root }));
  app.get("*", (c, next) =>
    c.req.path.startsWith("/api/")
      ? next()
      : serveStatic({ root, path: "index.html" })(c, next),
  );
}

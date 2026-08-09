import dotenv from "dotenv";
import env from "env-var";

dotenv.config();

export default {
  version: env.get("VERSION").required().asString(),
  environment: env
    .get("ENVIRONMENT")
    .default("dev")
    .asEnum(["dev", "beta", "prod"]),
  gitSha: env.get("GIT_SHA").required().asString(),
  sentryDsn: env.get("SENTRY_DSN").asString(),
  port: env.get("PORT").default("8000").asPortNumber(),
  discordToken: env.get("DISCORD_TOKEN").required().asString(),
  applicationId: env.get("APPLICATION_ID").required().asString(),
  // NOTE: `DATA_DIR` is deliberately absent. It located the sql.js database and
  // the static file root, both of which are gone; the database path now comes
  // from `DATABASE_PATH` (see src/db/index.ts). The deployment still sets
  // DATA_DIR because the pre-Prisma image requires it, and dropping it here
  // means a rollback does not depend on this file.
};

// required for type orm
import "reflect-metadata";
import { DataSource } from "typeorm";
import { Karma } from "./karma.ts";
import { KarmaCounts } from "./karma-counts.ts";
import { KarmaGiven } from "./karma-given.ts";
import { KarmaReceived } from "./karma-received.ts";
import { Person } from "./person.ts";
import configuration from "../configuration.ts";

export const dataSource = new DataSource({
  type: "sqlite",
  database: `${configuration.dataDir}/glitter.sqlite`,
  synchronize: false, // NEVER use true in production - it can wipe data!
  logging: true,
  entities: [Karma, Person, KarmaGiven, KarmaReceived, KarmaCounts],
  subscribers: [],
  migrations: [],
});

console.log(`[Database] Initializing database connection to ${configuration.dataDir}/glitter.sqlite`);
await dataSource.initialize();
console.log("[Database] Database connection initialized successfully");

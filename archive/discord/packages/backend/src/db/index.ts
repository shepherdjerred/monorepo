// required for type orm
import "npm:reflect-metadata@0.2.1";
import sqlite3 from "./shim/index.ts";
import { DataSource } from "npm:typeorm@0.3.20";
import {
  Karma,
  KarmaCounts,
  KarmaGiven,
  KarmaReceived,
  Person,
} from "./karma/index.ts";
import configuration from "../configuration.ts";

export const dataSource = new DataSource({
  type: "sqlite",
  database: `${configuration.dataDir}/glitter.sqlite`,
  synchronize: true,
  logging: true,
  entities: [Karma, Person, KarmaGiven, KarmaReceived, KarmaCounts],
  subscribers: [],
  migrations: [],
  driver: sqlite3,
});

await dataSource.initialize();

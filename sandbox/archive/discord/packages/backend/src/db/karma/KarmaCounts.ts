import { DataSource, ViewColumn, ViewEntity } from "npm:typeorm@0.3.20";
import { Person } from "./Person.ts";
import { KarmaGiven } from "./KarmaGiven.ts";
import { KarmaReceived } from "./KarmaReceived.ts";

@ViewEntity({
  expression: (dataSource: DataSource) =>
    dataSource
      .createQueryBuilder()
      .select("person.id", "id")
      .addSelect("received.karmaReceived", "karmaReceived")
      .addSelect("given.karmaGiven", "karmaGiven")
      .from(Person, "person")
      .leftJoin(KarmaGiven, "given", "given.id = person.id")
      .leftJoin(KarmaReceived, "received", "received.id= person.id"),
})
export class KarmaCounts {
  @ViewColumn()
  id!: string;

  @ViewColumn()
  karmaGiven!: number;

  @ViewColumn()
  karmaReceived!: number;
}

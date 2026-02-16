import { DataSource, ViewColumn, ViewEntity } from "typeorm";
import { Person } from "./person.ts";
import { KarmaGiven } from "./karma-given.ts";
import { KarmaReceived } from "./karma-received.ts";

@ViewEntity({
  expression: (dataSource: DataSource) =>
    dataSource
      .createQueryBuilder()
      .select("person.id", "id")
      .addSelect("COALESCE(received.guildId, given.guildId)", "guildId")
      .addSelect("received.karmaReceived", "karmaReceived")
      .addSelect("given.karmaGiven", "karmaGiven")
      .from(Person, "person")
      .leftJoin(KarmaGiven, "given", "given.id = person.id")
      .leftJoin(KarmaReceived, "received", "received.id = person.id AND received.guildId = given.guildId"),
})
export class KarmaCounts {
  @ViewColumn()
  id!: string;

  @ViewColumn()
  guildId!: string | null;

  @ViewColumn()
  karmaGiven!: number;

  @ViewColumn()
  karmaReceived!: number;
}

import { DataSource, ViewColumn, ViewEntity } from "typeorm";
import { Karma } from "./karma.ts";

@ViewEntity({
  expression: (dataSource: DataSource) =>
    dataSource
      .createQueryBuilder()
      .select("receiverId", "id")
      .addSelect("guildId", "guildId")
      .addSelect("SUM(amount)", "karmaReceived")
      .from(Karma, "karma")
      .groupBy("receiverId")
      .addGroupBy("guildId")
      .orderBy("karmaReceived", "DESC", "NULLS LAST"),
})
export class KarmaReceived {
  @ViewColumn()
  id!: string;

  @ViewColumn()
  guildId!: string | null;

  @ViewColumn()
  karmaReceived!: number;
}

import { DataSource, ViewColumn, ViewEntity } from "typeorm";
import { Karma } from "./karma.ts";

@ViewEntity({
  expression: (dataSource: DataSource) =>
    dataSource
      .createQueryBuilder()
      .select("giverId", "id")
      .addSelect("guildId", "guildId")
      .addSelect("SUM(amount)", "karmaGiven")
      .from(Karma, "karma")
      .groupBy("giverId")
      .addGroupBy("guildId")
      .orderBy("karmaGiven", "DESC", "NULLS LAST"),
})
export class KarmaGiven {
  @ViewColumn()
  id!: string;

  @ViewColumn()
  guildId!: string | null;

  @ViewColumn()
  karmaGiven!: number;
}

import { DataSource, ViewColumn, ViewEntity } from "npm:typeorm@0.3.20";
import { Karma } from "./Karma.ts";

@ViewEntity({
  expression: (dataSource: DataSource) =>
    dataSource
      .createQueryBuilder()
      .select("giverId", "id")
      .addSelect("SUM(amount)", "karmaGiven")
      .from(Karma, "karma")
      .groupBy("giverId")
      .orderBy("karmaGiven", "DESC", "NULLS LAST"),
})
export class KarmaGiven {
  @ViewColumn()
  id!: string;

  @ViewColumn()
  karmaGiven!: number;
}

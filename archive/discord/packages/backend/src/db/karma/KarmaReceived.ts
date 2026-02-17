import { DataSource, ViewColumn, ViewEntity } from "npm:typeorm@0.3.20";
import { Karma } from "./Karma.ts";

@ViewEntity({
  expression: (dataSource: DataSource) =>
    dataSource
      .createQueryBuilder()
      .select("receiverId", "id")
      .addSelect("SUM(amount)", "karmaReceived")
      .from(Karma, "karma")
      .groupBy("receiverId")
      .orderBy("karmaReceived", "DESC", "NULLS LAST"),
})
export class KarmaReceived {
  @ViewColumn()
  id!: string;

  @ViewColumn()
  karmaReceived!: number;
}

import { Entity, OneToMany, PrimaryColumn, type Relation } from "typeorm";
import { Karma } from "./karma.ts";

@Entity()
export class Person {
  @PrimaryColumn()
  id!: string;

  @OneToMany(() => Karma, (karma: Karma) => karma.giver)
  given!: Relation<Karma[]>;

  @OneToMany(() => Karma, (karma: Karma) => karma.receiver)
  received!: Relation<Karma[]>;
}

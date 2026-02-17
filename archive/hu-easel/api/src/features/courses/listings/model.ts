import {
  AllowNull,
  Column,
  DataType,
  Default,
  HasMany,
  IsUUID,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { Content } from "../contents/model";

@Table
export class Listing extends Model<Listing> {
  @PrimaryKey
  @IsUUID(4)
  @Default(DataType.UUIDV4)
  @Column
  uuid: string;

  @AllowNull(false)
  @Column
  department: string;

  @AllowNull(false)
  @Column
  identifier: number;

  @HasMany(() => Content)
  contents: Content[];
}

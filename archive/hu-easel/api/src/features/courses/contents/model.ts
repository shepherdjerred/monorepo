import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  IsUUID,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { Listing } from "../listings/model";
import { Course } from "../model";

@Table
export class Content extends Model<Content> {
  @PrimaryKey
  @IsUUID(4)
  @Default(DataType.UUIDV4)
  @Column
  uuid: string;

  @AllowNull(false)
  @Column
  name: string;

  @ForeignKey(() => Listing)
  @IsUUID(4)
  @Column
  listingUuid: string;

  @BelongsTo(() => Listing)
  listing: Listing;

  @HasMany(() => Course)
  courses: Course[];
}

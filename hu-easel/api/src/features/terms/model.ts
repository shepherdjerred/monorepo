import { AllowNull, Column, DataType, Default, HasMany, IsUUID, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { Course } from '../courses/model';

export enum TermType {
  FALL,
  SPRING,
  SUMMER_ONE,
  SUMMER_TWO,
  INTERSESSION_ONE,
  INTERSESSION_TWO
}

@Table
export class Term extends Model<Term> {
  @PrimaryKey
  @IsUUID(4)
  @Default(DataType.UUIDV4)
  @Column
  uuid: string;

  @AllowNull(false)
  @Column
  type: TermType;

  @AllowNull(false)
  @Column
  startDate: Date;

  @AllowNull(false)
  @Column
  endDate: Date;

  @HasMany(() => Course)
  courses: Course[];
}

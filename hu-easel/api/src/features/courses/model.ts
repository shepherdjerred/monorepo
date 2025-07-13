import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  IsUUID,
  Model,
  PrimaryKey, Table
} from 'sequelize-typescript';
import { Content } from './contents/model';
import { Term } from '../terms/model';

@Table
export class Course extends Model<Course> {
  @PrimaryKey
  @IsUUID(4)
  @Default(DataType.UUIDV4)
  @Column
  uuid: string;

  @AllowNull(false)
  @Column
  section: number;

  @ForeignKey(() => Content)
  @IsUUID(4)
  @Column
  contentUuid: string;

  @BelongsTo(() => Content)
  content: Content;

  @ForeignKey(() => Term)
  @IsUUID(4)
  @Column
  termUuid: string;

  @BelongsTo(() => Term)
  term: Term;

}

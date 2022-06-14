import { compare, hash, hashSync } from 'bcryptjs';
import {
  AllowNull,
  Column,
  DataType,
  Default,
  Is,
  IsAlpha,
  IsUUID,
  Model,
  NotEmpty,
  PrimaryKey,
  Table,
  Unique
} from 'sequelize-typescript';

const SALT_ROUNDS = 10;

export enum UserRole {
  STUDENT = 'STUDENT',
  PROFESSOR = 'PROFESSOR',
  ADMIN = 'ADMIN'
}

export interface PublicUserAttributes {
  uuid: string;
  username: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

@Table
export class User extends Model<User> {

  @PrimaryKey
  @IsUUID(4)
  @Default(DataType.UUIDV4)
  @Column
  uuid: string;

  @Unique
  @AllowNull(false)
  @NotEmpty
  @Column
  username: string;

  @AllowNull(false)
  @NotEmpty
  @IsAlpha
  @Column
  firstName: string;

  @AllowNull(false)
  @NotEmpty
  @IsAlpha
  @Column
  lastName: string;

  @Unique
  @NotEmpty
  @AllowNull(false)
  @Is(/H[\d]{8}\b/i)
  @Column
  hNumber: string;

  @AllowNull(false)
  @Default(UserRole.STUDENT)
  @Column
  role: UserRole;

  @NotEmpty
  @AllowNull(false)
  @Column(DataType.STRING.BINARY)
  get password (): string {
    return this.getDataValue('password');
  }

  set password (password: string) {
    password = User.hashPasswordSync(password);
    this.setDataValue('password', password);
  }

  static hashPasswordSync (password: string): string {
    return hashSync(password, SALT_ROUNDS);
  }

  static hashPassword (password: string): Promise<string> {
    return hash(password, SALT_ROUNDS);
  }

  validatePassword (candidate: string): Promise<boolean> {
    return compare(candidate, this.password);
  }

  toJSON (): PublicUserAttributes {
    return {
      uuid: this.uuid,
      username: this.username,
      firstName: this.firstName,
      lastName: this.lastName,
      role: this.role
    };
  }
}

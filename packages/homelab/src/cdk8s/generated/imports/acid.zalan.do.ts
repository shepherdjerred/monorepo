import type { ApiObjectMetadata, GroupVersionKind } from "cdk8s";
import type { Construct } from "constructs";
import { CompatApiObject, type CompatProps, manifestFor } from "./_compat.ts";

export interface PostgresqlProps extends CompatProps {
  readonly metadata?: ApiObjectMetadata;
  readonly spec: CompatProps;
}

export class Postgresql extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "acid.zalan.do/v1",
    kind: "postgresql",
  };

  public static manifest(props: PostgresqlProps): Record<string, unknown> {
    return manifestFor(Postgresql.GVK, props);
  }

  public constructor(scope: Construct, id: string, props: PostgresqlProps) {
    super(scope, id, Postgresql.GVK, props);
  }
}

export enum PostgresqlSpecPostgresqlVersion {
  VALUE_13 = "13",
  VALUE_14 = "14",
  VALUE_15 = "15",
  VALUE_16 = "16",
  VALUE_17 = "17",
}

export enum PostgresqlSpecUsers {
  CREATEDB = "createdb",
  LOGIN = "login",
  SUPERUSER = "superuser",
}

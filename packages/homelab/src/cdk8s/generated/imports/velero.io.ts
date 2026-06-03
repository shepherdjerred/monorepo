import type { ApiObjectMetadata, GroupVersionKind } from "cdk8s";
import type { Construct } from "constructs";
import { CompatApiObject, type CompatProps, manifestFor } from "./_compat.ts";

export interface ScheduleProps extends CompatProps {
  readonly metadata?: ApiObjectMetadata;
}

export class Schedule extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "velero.io/v1",
    kind: "Schedule",
  };

  public static manifest(props: ScheduleProps = {}): Record<string, unknown> {
    return manifestFor(Schedule.GVK, props);
  }

  public constructor(scope: Construct, id: string, props: ScheduleProps = {}) {
    super(scope, id, Schedule.GVK, props);
  }
}

import type { ApiObjectMetadata, GroupVersionKind } from "cdk8s";
import type { Construct } from "constructs";
import { CompatApiObject, type CompatProps, manifestFor } from "./_compat.ts";

export interface ApplicationProps extends CompatProps {
  readonly metadata?: ApiObjectMetadata;
  readonly spec: CompatProps;
}

export class Application extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
  };

  public static manifest(props: ApplicationProps): Record<string, unknown> {
    return manifestFor(Application.GVK, props);
  }

  public constructor(scope: Construct, id: string, props: ApplicationProps) {
    super(scope, id, Application.GVK, props);
  }
}

export interface AppProjectProps extends CompatProps {
  readonly metadata?: ApiObjectMetadata;
  readonly spec: CompatProps;
}

export class AppProject extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "AppProject",
  };

  public static manifest(props: AppProjectProps): Record<string, unknown> {
    return manifestFor(AppProject.GVK, props);
  }

  public constructor(scope: Construct, id: string, props: AppProjectProps) {
    super(scope, id, AppProject.GVK, props);
  }
}

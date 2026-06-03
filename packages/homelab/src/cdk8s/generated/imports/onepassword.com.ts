import type { ApiObjectMetadata, GroupVersionKind } from "cdk8s";
import type { Construct } from "constructs";
import { CompatApiObject, type CompatProps, manifestFor } from "./_compat.ts";

export interface OnePasswordItemProps extends CompatProps {
  readonly metadata?: ApiObjectMetadata;
}

export class OnePasswordItem extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "onepassword.com/v1",
    kind: "OnePasswordItem",
  };

  public static manifest(
    props: OnePasswordItemProps = {},
  ): Record<string, unknown> {
    return manifestFor(OnePasswordItem.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: OnePasswordItemProps = {},
  ) {
    super(scope, id, OnePasswordItem.GVK, props);
  }
}

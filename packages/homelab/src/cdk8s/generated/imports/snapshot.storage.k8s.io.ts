import type { ApiObjectMetadata, GroupVersionKind } from "cdk8s";
import type { Construct } from "constructs";
import { CompatApiObject, type CompatProps, manifestFor } from "./_compat.ts";

export interface VolumeSnapshotClassProps extends CompatProps {
  readonly metadata?: ApiObjectMetadata;
  readonly deletionPolicy: VolumeSnapshotClassDeletionPolicy;
  readonly driver: string;
  readonly parameters?: Record<string, string>;
}

export class VolumeSnapshotClass extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "snapshot.storage.k8s.io/v1",
    kind: "VolumeSnapshotClass",
  };

  public static manifest(
    props: VolumeSnapshotClassProps,
  ): Record<string, unknown> {
    return manifestFor(VolumeSnapshotClass.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: VolumeSnapshotClassProps,
  ) {
    super(scope, id, VolumeSnapshotClass.GVK, props);
  }
}

export enum VolumeSnapshotClassDeletionPolicy {
  DELETE = "Delete",
  RETAIN = "Retain",
}

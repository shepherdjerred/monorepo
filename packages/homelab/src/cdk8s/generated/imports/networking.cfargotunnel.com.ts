import type { ApiObjectMetadata, GroupVersionKind } from "cdk8s";
import type { Construct } from "constructs";
import { CompatApiObject, type CompatProps, manifestFor } from "./_compat.ts";

export interface ClusterTunnelProps extends CompatProps {
  readonly metadata?: ApiObjectMetadata;
}

export class ClusterTunnel extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "networking.cfargotunnel.com/v1alpha1",
    kind: "ClusterTunnel",
  };

  public static manifest(
    props: ClusterTunnelProps = {},
  ): Record<string, unknown> {
    return manifestFor(ClusterTunnel.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: ClusterTunnelProps = {},
  ) {
    super(scope, id, ClusterTunnel.GVK, props);
  }
}

export interface TunnelBindingProps extends CompatProps {
  readonly metadata?: ApiObjectMetadata;
  readonly tunnelRef: CompatProps;
  readonly subjects: readonly CompatProps[];
}

export class TunnelBinding extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "networking.cfargotunnel.com/v1alpha1",
    kind: "TunnelBinding",
  };

  public static manifest(props: TunnelBindingProps): Record<string, unknown> {
    return manifestFor(TunnelBinding.GVK, props);
  }

  public constructor(scope: Construct, id: string, props: TunnelBindingProps) {
    super(scope, id, TunnelBinding.GVK, props);
  }
}

export enum TunnelBindingTunnelRefKind {
  CLUSTER_TUNNEL = "ClusterTunnel",
  TUNNEL = "Tunnel",
}

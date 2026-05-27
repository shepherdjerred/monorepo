// Hand-maintained strict types for the adyanth/cloudflare-operator CRDs
// (`networking.cfargotunnel.com`, v1alpha1 schema). Lives in src/ — not
// generated/ — so it survives any future rerun of scripts/update-imports.ts.
//
// When bumping cloudflare-operator, diff the live CRD's openAPIV3Schema and
// update both together:
//   kubectl get crd clustertunnels.networking.cfargotunnel.com \
//     -o jsonpath='{.spec.versions[?(@.name=="v1alpha1")].schema.openAPIV3Schema}'
//   kubectl get crd tunnelbindings.networking.cfargotunnel.com \
//     -o jsonpath='{.spec.versions[?(@.name=="v1alpha1")].schema.openAPIV3Schema}'
//
// Background: packages/docs/plans/2026-05-26_cdk8s-cfargotunnel-strict-types.md

import {
  ApiObject,
  type ApiObjectMetadata,
  type GroupVersionKind,
} from "cdk8s";
import type { Construct } from "constructs";

// ---- ClusterTunnel ------------------------------------------------------

export type ClusterTunnelSpecCloudflare = {
  readonly secret: string;
  readonly domain: string;
  readonly accountId?: string;
  readonly accountName?: string;
  readonly email?: string;
  // SHOUTING_SNAKE_CASE: key names *inside* the credential Secret. Operator
  // defaults match the field name; only set if remapping is needed, and note
  // these only take effect in `existingTunnel:` mode.
  readonly CLOUDFLARE_API_KEY?: string;
  readonly CLOUDFLARE_API_TOKEN?: string;
  readonly CLOUDFLARE_TUNNEL_CREDENTIAL_FILE?: string;
  readonly CLOUDFLARE_TUNNEL_CREDENTIAL_SECRET?: string;
};

export type ClusterTunnelSpec = {
  readonly cloudflare: ClusterTunnelSpecCloudflare;
  readonly newTunnel?: { readonly name: string };
  readonly existingTunnel?: { readonly id?: string; readonly name?: string };
  readonly fallbackTarget?: string;
  readonly image?: string;
  readonly noTlsVerify?: boolean;
  readonly nodeSelectors?: Readonly<Record<string, string>>;
  readonly originCaPool?: string;
  readonly protocol?: "auto" | "quic" | "http2";
  readonly size?: number;
};

export type ClusterTunnelProps = {
  readonly metadata?: ApiObjectMetadata;
  readonly spec: ClusterTunnelSpec;
};

export class ClusterTunnel extends ApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "networking.cfargotunnel.com/v1alpha1",
    kind: "ClusterTunnel",
  };

  public constructor(scope: Construct, id: string, props: ClusterTunnelProps) {
    super(scope, id, {
      ...ClusterTunnel.GVK,
      metadata: props.metadata,
      spec: props.spec,
    });
  }
}

// ---- TunnelBinding ------------------------------------------------------

export enum TunnelBindingTunnelRefKind {
  CLUSTER_TUNNEL = "ClusterTunnel",
  TUNNEL = "Tunnel",
}

export type TunnelBindingTunnelRef = {
  readonly kind: TunnelBindingTunnelRefKind;
  readonly name: string;
  readonly disableDNSUpdates?: boolean;
};

export type TunnelBindingSubjectSpec = {
  readonly fqdn?: string;
  readonly target?: string;
  readonly protocol?: "http" | "https" | "tcp" | "udp" | "ssh" | "rdp";
  readonly noTlsVerify?: boolean;
  readonly http2Origin?: boolean;
  readonly path?: string;
  readonly caPool?: string;
  readonly proxyAddress?: string;
  readonly proxyPort?: number;
  readonly proxyType?: "" | "socks";
};

export type TunnelBindingSubject = {
  readonly name: string;
  readonly kind?: "Service";
  readonly spec?: TunnelBindingSubjectSpec;
};

export type TunnelBindingProps = {
  readonly metadata?: ApiObjectMetadata;
  readonly tunnelRef: TunnelBindingTunnelRef;
  readonly subjects: readonly TunnelBindingSubject[];
};

export class TunnelBinding extends ApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "networking.cfargotunnel.com/v1alpha1",
    kind: "TunnelBinding",
  };

  public constructor(scope: Construct, id: string, props: TunnelBindingProps) {
    super(scope, id, {
      ...TunnelBinding.GVK,
      metadata: props.metadata,
      tunnelRef: props.tunnelRef,
      subjects: props.subjects,
    });
  }
}

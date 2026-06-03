import type { ApiObjectMetadata, GroupVersionKind } from "cdk8s";
import type { Construct } from "constructs";
import { CompatApiObject, type CompatProps, manifestFor } from "./_compat.ts";

type NumberOrString = number | string;

export class IntOrString {
  public static fromString(value: string): IntOrString {
    return new IntOrString(value);
  }

  public static fromNumber(value: number): IntOrString {
    return new IntOrString(value);
  }

  private constructor(private readonly value: NumberOrString) {}

  public toJSON(): NumberOrString {
    return this.value;
  }
}

export class Quantity {
  public static fromString(value: string): Quantity {
    return new Quantity(value);
  }

  public static fromNumber(value: number): Quantity {
    return new Quantity(value);
  }

  private constructor(private readonly value: NumberOrString) {}

  public toJSON(): NumberOrString {
    return this.value;
  }
}

interface KubernetesResourceProps extends CompatProps {
  readonly metadata?: ApiObjectMetadata;
}

function kubeManifest(
  gvk: GroupVersionKind,
  props: KubernetesResourceProps = {},
): Record<string, unknown> {
  return manifestFor(gvk, props);
}

export class KubeClusterRole extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRole",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeClusterRole.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeClusterRole.GVK, props);
  }
}

export class KubeClusterRoleBinding extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRoleBinding",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeClusterRoleBinding.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeClusterRoleBinding.GVK, props);
  }
}

export class KubeConfigMap extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "v1",
    kind: "ConfigMap",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeConfigMap.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeConfigMap.GVK, props);
  }
}

export class KubeCronJob extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "batch/v1",
    kind: "CronJob",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeCronJob.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeCronJob.GVK, props);
  }
}

export class KubeDeployment extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "apps/v1",
    kind: "Deployment",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeDeployment.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeDeployment.GVK, props);
  }
}

export class KubeIngress extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeIngress.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeIngress.GVK, props);
  }
}

export class KubeJob extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "batch/v1",
    kind: "Job",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeJob.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeJob.GVK, props);
  }
}

export class KubeLimitRange extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "v1",
    kind: "LimitRange",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeLimitRange.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeLimitRange.GVK, props);
  }
}

export class KubeNetworkPolicy extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeNetworkPolicy.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeNetworkPolicy.GVK, props);
  }
}

export class KubePersistentVolumeClaim extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubePersistentVolumeClaim.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubePersistentVolumeClaim.GVK, props);
  }
}

export class KubePriorityClass extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "scheduling.k8s.io/v1",
    kind: "PriorityClass",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubePriorityClass.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubePriorityClass.GVK, props);
  }
}

export class KubeRole extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeRole.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeRole.GVK, props);
  }
}

export class KubeRoleBinding extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeRoleBinding.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeRoleBinding.GVK, props);
  }
}

export class KubeService extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "v1",
    kind: "Service",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeService.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeService.GVK, props);
  }
}

export class KubeServiceAccount extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "v1",
    kind: "ServiceAccount",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeServiceAccount.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeServiceAccount.GVK, props);
  }
}

export class KubeStorageClass extends CompatApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "storage.k8s.io/v1",
    kind: "StorageClass",
  };

  public static manifest(
    props: KubernetesResourceProps = {},
  ): Record<string, unknown> {
    return kubeManifest(KubeStorageClass.GVK, props);
  }

  public constructor(
    scope: Construct,
    id: string,
    props: KubernetesResourceProps = {},
  ) {
    super(scope, id, KubeStorageClass.GVK, props);
  }
}

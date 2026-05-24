// Generated-compatible minimal bindings for the Prometheus Operator resources
// used by this package.
import { ApiObject, type ApiObjectMetadata, type GroupVersionKind } from "cdk8s";
import type { Construct } from "constructs";

type JsonObject = Record<string, unknown>;

export interface ProbeProps {
  readonly metadata: ApiObjectMetadata;
  readonly spec: JsonObject;
}

export class Probe extends ApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "Probe",
  };

  public constructor(scope: Construct, id: string, props: ProbeProps) {
    super(scope, id, {
      ...Probe.GVK,
      ...props,
    });
  }
}

export interface PrometheusRuleProps {
  readonly metadata: ApiObjectMetadata;
  readonly spec: {
    readonly groups: PrometheusRuleSpecGroups[];
  };
}

export interface PrometheusRuleSpecGroups {
  readonly interval?: string;
  readonly labels?: Record<string, string>;
  readonly limit?: number;
  readonly name: string;
  readonly partialResponseStrategy?: string;
  readonly queryOffset?: string;
  readonly rules: readonly PrometheusRuleSpecGroupsRules[];
}

export interface PrometheusRuleSpecGroupsRules {
  readonly alert?: string;
  readonly annotations?: Record<string, string>;
  readonly expr: string;
  readonly for?: string;
  readonly labels?: Record<string, string>;
  readonly record?: string;
}

export class PrometheusRuleSpecGroupsRulesExpr {
  public static fromString(value: string): string {
    return value;
  }
}

export class PrometheusRule extends ApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "PrometheusRule",
  };

  public constructor(scope: Construct, id: string, props: PrometheusRuleProps) {
    super(scope, id, {
      ...PrometheusRule.GVK,
      ...props,
    });
  }
}

export interface ServiceMonitorProps {
  readonly metadata: ApiObjectMetadata;
  readonly spec: JsonObject;
}

export class ServiceMonitor extends ApiObject {
  public static readonly GVK: GroupVersionKind = {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
  };

  public constructor(scope: Construct, id: string, props: ServiceMonitorProps) {
    super(scope, id, {
      ...ServiceMonitor.GVK,
      ...props,
    });
  }
}

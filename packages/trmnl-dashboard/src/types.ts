import type { Status } from "./status.ts";

export type TrmnlPayload = HomePayload | HomelabPayload;

export type EntitySummary = {
  entity_id: string;
  label: string;
  state: string;
  status: Status;
  detail?: string;
};

export type HomePayload = {
  screen: "home";
  generated_at: string;
  status: Status;
  summary: string;
  counts: {
    unavailable: number;
    low_battery: number;
  };
  presence: EntitySummary[];
  security: EntitySummary[];
  climate: EntitySummary[];
  unavailable: EntitySummary[];
  low_batteries: EntitySummary[];
  errors: string[];
};

export type HomelabPayload = {
  screen: "homelab";
  generated_at: string;
  status: Status;
  summary: string;
  bugsink: BugsinkSection;
  pagerduty: PagerDutySection;
  kubernetes: KubernetesSection;
  storage: StorageSection;
  hardware: HardwareSection;
  alerts: AlertsSection;
  errors: string[];
};

export type BugsinkSection = {
  status: Status;
  unresolved: number;
  projects: { name: string; unresolved: number }[];
};

export type PagerDutySection = {
  status: Status;
  triggered: number;
  acknowledged: number;
  on_call: string[];
};

export type KubernetesSection = {
  status: Status;
  ready_nodes: number;
  total_nodes: number;
  unhealthy_pods: number;
};

export type StorageSection = {
  status: Status;
  max_disk_used_percent: number | null;
  volumes: { name: string; used_percent: number }[];
};

export type HardwareSection = {
  status: Status;
  cpu_used_percent: number | null;
  memory_used_percent: number | null;
};

export type AlertsSection = {
  status: Status;
  critical: number;
  warning: number;
};

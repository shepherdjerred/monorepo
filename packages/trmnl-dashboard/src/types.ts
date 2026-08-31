import type { Status } from "./status.ts";

export type TrmnlPayload = HomePayload | HomelabPayload | PetCarePayload;

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
  generated_time: string;
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
  generated_time: string;
  status: Status;
  summary: string;
  bugsink: BugsinkSection;
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
  open: number;
  critical: number;
  warning: number;
  info: number;
  recent: { severity: string; alertname: string; summary: string }[];
};

export type PetProblem = {
  severity: "warning" | "critical";
  alert: string;
  summary: string;
};

export type PetCarePayload = {
  screen: "pets";
  generated_at: string;
  generated_time: string;
  status: Status;
  summary: string;
  problems: PetProblem[];
  fountain: {
    status: Status;
    water_percent: number | null;
    water_ounces: number | null;
    cleaning_days: number | null;
    filter_days: number | null;
    dispensing: boolean | null;
    dispensing_mode: string | null;
    wifi: boolean | null;
    drinking_ounces_today: number | null;
    drinking_visits_today: number | null;
  };
  feeders: {
    id: "living-room" | "guest-room";
    label: string;
    status: Status;
    food_low: boolean | null;
    dispenser_problem: boolean | null;
    battery_problem: boolean | null;
    wifi: boolean | null;
    desiccant_days: number | null;
    last_feed_at: string | null;
    feedings_today: number | null;
    food_grams_today: number | null;
  }[];
  litter_robot: {
    status: Status;
    name: string;
    online: boolean;
    ready: boolean;
    litter_percent: number;
    waste_percent: number;
    hopper_status: string;
    hopper_level_raw: number | null;
    hopper_installed: boolean;
    hopper_enabled: boolean;
    last_seen_at: string;
    filter_due_at: string | null;
    cycles_today: number | null;
  } | null;
  vacuums: {
    id: "1st-floor" | "2nd-floor" | "3rd-floor";
    label: string;
    status: Status;
    state: string | null;
    battery_percent: number | null;
    last_clean_at: string | null;
    consumable_hours: number | null;
    clean_water_empty: boolean | null;
    dirty_water_full: boolean | null;
    cleaning_fluid_low: boolean | null;
    water_shortage: boolean | null;
    dust_bag: null;
  }[];
  activity: {
    drinking_ounces: number | null;
    drinking_visits: number | null;
    feedings: number | null;
    food_grams: number | null;
    litter_cycles: number | null;
  };
  errors: string[];
};

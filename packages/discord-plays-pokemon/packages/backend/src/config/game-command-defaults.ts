import type { Config } from "./schema.ts";

/** Shared command timing and bounds for standalone Emerald and Arcade. */
export const gameCommandDefaults = {
  enabled: true,
  max_actions_per_command: 20,
  max_quantity_per_action: 10,
  key_press_duration_in_milliseconds: 15,
  delay_between_actions_in_milliseconds: 5,
  burst: {
    duration_in_milliseconds: 15,
    delay_in_milliseconds: 5,
    quantity: 3,
  },
  chord: {
    duration_in_milliseconds: 15,
    max_commands: 10,
    max_total: 10,
    delay: 5,
  },
  hold: { duration_in_milliseconds: 150 },
} satisfies Config["game"]["commands"];

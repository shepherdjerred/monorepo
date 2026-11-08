// Build-only native program approvals. Scene/actor observations are excluded.
import { WORLD_DESCRIPTOR_ABI_SHA } from "../latest-world-descriptor-abi.mjs";
import { BUILTIN_RESOURCE_CONTEXTS_SHA } from "../latest-builtin-resource-contexts.mjs";
import { STARTUP_CONFIG_SHA } from "../latest-startup-config.mjs";
import { EFFECT_CREATION_PACKAGE_SHA } from "../latest-effect-creation.mjs";
import { EFFECT_REMOVAL_PACKAGE_SHA } from "../latest-effect-removal.mjs";
import { LATEST_REPLICATION_SHA } from "../latest-replication.mjs";
import { CHAMPION_STATE_SHA } from "../latest-champion-state.mjs";
import { COMBAT_STATS_SHA } from "../latest-combat-stats.mjs";
import { INVENTORY_SHA } from "../latest-inventory.mjs";
import { EXPERIENCE_SHA } from "../latest-experience.mjs";
import { APPEARANCE_STACK_INPUTS_SHA } from "../latest-appearance-stack-inputs.mjs";
import { UNIT_FORM_INPUTS_SHA } from "../latest-unit-form-inputs.mjs";
import { MISSILE_TARGET_INPUTS_SHA } from "../latest-missile-targets.mjs";
import { TARGET_VISIBILITY_INPUTS_SHA } from "../latest-target-visibility.mjs";
import { TARGET_VISIBILITY_MASK_INPUTS_SHA } from "../latest-target-visibility-masks.mjs";
export const SELECTED_BUILD_PROGRAMS = Object.freeze(
  [
    ["latest-world-descriptor-abi/package.json", WORLD_DESCRIPTOR_ABI_SHA],
    [
      "latest-builtin-resource-contexts/package.json",
      BUILTIN_RESOURCE_CONTEXTS_SHA,
    ],
    ["latest-startup-config/package.json", STARTUP_CONFIG_SHA],
    ["latest-effect-creation/package.json", EFFECT_CREATION_PACKAGE_SHA],
    ["latest-effect-removal/package.json", EFFECT_REMOVAL_PACKAGE_SHA],
    ["latest-replication/package.json", LATEST_REPLICATION_SHA],
    ["latest-champion-state/package.json", CHAMPION_STATE_SHA],
    ["latest-combat-stats/package.json", COMBAT_STATS_SHA],
    ["latest-inventory/package.json", INVENTORY_SHA],
    ["latest-experience/package.json", EXPERIENCE_SHA],
    [
      "latest-appearance-stack-inputs/package.json",
      APPEARANCE_STACK_INPUTS_SHA,
    ],
    ["latest-unit-form-inputs/package.json", UNIT_FORM_INPUTS_SHA],
    ["latest-missile-targets/package.json", MISSILE_TARGET_INPUTS_SHA],
    ["latest-target-visibility/package.json", TARGET_VISIBILITY_INPUTS_SHA],
    [
      "latest-target-visibility-masks/package.json",
      TARGET_VISIBILITY_MASK_INPUTS_SHA,
    ],
  ].map((row) => Object.freeze(row)),
);

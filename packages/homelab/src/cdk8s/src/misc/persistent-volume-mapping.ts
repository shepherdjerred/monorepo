import { PersistentVolume, type IPersistentVolume } from "cdk8s-plus-31";
import { Construct } from "constructs";

/**
 * Central mapping of logical PV names to actual PV UUIDs
 * This makes it easier to reference existing PVs in the codebase
 */
export const PV_MAPPINGS = {
  empty: "empty", // empty PV so that it keyof doesn't evaluate to `never`
} as const;

export type PVMappingKey = keyof typeof PV_MAPPINGS;

/**
 * Helper function to get a PersistentVolume reference from the mapping
 * @param scope - The construct scope
 * @param logicalName - The logical name from PV_MAPPINGS
 * @returns IPersistentVolume reference
 */
export function getPersistentVolume(scope: Construct, logicalName: PVMappingKey): IPersistentVolume {
  const pvName = PV_MAPPINGS[logicalName];
  return PersistentVolume.fromPersistentVolumeName(scope, `pv-${logicalName}`, pvName);
}

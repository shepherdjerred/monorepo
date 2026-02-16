import { z } from "zod";

/**
 * Enum schemas used across match DTOs
 */

export const DescriptionSchema = z.enum(["primaryStyle", "subStyle"]);

export const PositionSchema = z.enum([
  "",
  "Invalid",
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
]);

// Role field supports both legacy values (CARRY, SUPPORT) and newer values (DUO_CARRY, DUO_SUPPORT)
// depending on game mode and API version
export const RoleSchema = z.enum([
  "SOLO",
  "NONE",
  "CARRY",
  "SUPPORT",
  "DUO_CARRY",
  "DUO_SUPPORT",
  "DUO",
]);

export const LaneSchema = z.enum(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "NONE"]);

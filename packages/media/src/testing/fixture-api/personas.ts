import type { z } from "zod";
import type { MediaUser, UserRoleSchema } from "#shared/contract.ts";
import { fixtureId } from "./support.ts";

/** The two signed-in views the fixture API can serve: one per user role. */
export type Persona = z.infer<typeof UserRoleSchema>;

export const OWNER: MediaUser = {
  id: fixtureId(1, 1),
  plexAccountId: "48211973",
  displayName: "Robin",
  role: "owner",
  restricted: false,
  version: 3,
};
export const MEMBER: MediaUser = {
  id: fixtureId(1, 2),
  plexAccountId: "51907324",
  displayName: "Mei",
  role: "member",
  restricted: false,
  version: 2,
};
export const ALEX: MediaUser = {
  id: fixtureId(1, 3),
  plexAccountId: "60218845",
  displayName: "Alex",
  role: "member",
  restricted: true,
  version: 5,
};
export const SAM: MediaUser = {
  id: fixtureId(1, 4),
  plexAccountId: "39911260",
  displayName: "Sam",
  role: "member",
  restricted: false,
  version: 1,
};
/** A managed Plex Home profile under the owner's account. */
export const KIDS: MediaUser = {
  id: fixtureId(1, 5),
  plexAccountId: "48211973:home:7",
  displayName: "Kids",
  role: "member",
  restricted: false,
  version: 1,
};

export const HOUSEHOLD: readonly MediaUser[] = [OWNER, MEMBER, ALEX, SAM, KIDS];

export function personaUser(persona: Persona): MediaUser {
  return persona === "owner" ? OWNER : MEMBER;
}

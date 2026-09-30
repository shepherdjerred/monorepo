package com.shepherdjerred.thestorm.core.protection;

/** What kind of creature a harmful effect would hit. */
public enum HarmTarget {
  /** Another player. Governed by PvP on both the attacker's and the victim's land. */
  PLAYER,
  /** A pet, farm animal, villager or other non-hostile creature. Governed by the victim's land. */
  PASSIVE,
}

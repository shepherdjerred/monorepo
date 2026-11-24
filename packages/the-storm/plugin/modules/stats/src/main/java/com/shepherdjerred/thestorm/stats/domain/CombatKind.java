package com.shepherdjerred.thestorm.stats.domain;

/** Canonical survival combat categories in the ingest-v1 wire contract. */
public enum CombatKind {
  PVP("pvp"),
  PVE_KILL("pve_kill"),
  PVE_DEATH("pve_death"),
  ENV_DEATH("env_death");

  private final String wire;

  CombatKind(String wire) {
    this.wire = wire;
  }

  public String wire() {
    return wire;
  }
}

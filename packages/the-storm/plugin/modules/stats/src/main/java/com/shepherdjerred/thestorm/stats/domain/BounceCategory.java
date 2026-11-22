package com.shepherdjerred.thestorm.stats.domain;

/** Canonical login/kick bounce categories in the ingest-v1 wire contract. */
public enum BounceCategory {
  BANNED("banned"),
  ALLOWLIST("allowlist"),
  MAINTENANCE("maintenance"),
  FULL("full"),
  KICKED("kicked"),
  OTHER("other");

  private final String wire;

  BounceCategory(String wire) {
    this.wire = wire;
  }

  public String wire() {
    return wire;
  }
}

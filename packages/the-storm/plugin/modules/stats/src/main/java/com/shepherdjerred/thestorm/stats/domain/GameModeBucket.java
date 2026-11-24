package com.shepherdjerred.thestorm.stats.domain;

/** Canonical gameplay mode buckets in the ingest-v1 wire contract. */
public enum GameModeBucket {
  SURVIVAL("survival"),
  CREATIVE("creative"),
  ARENA("arena"),
  RWF("rwf");

  private final String wire;

  GameModeBucket(String wire) {
    this.wire = wire;
  }

  public String wire() {
    return wire;
  }
}

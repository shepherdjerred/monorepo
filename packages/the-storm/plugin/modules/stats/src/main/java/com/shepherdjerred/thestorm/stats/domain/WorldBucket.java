package com.shepherdjerred.thestorm.stats.domain;

/** Canonical world buckets in the ingest-v1 wire contract. */
public enum WorldBucket {
  FRONTIER("frontier"),
  WORLD("world"),
  MAP2("map2"),
  SKYLANDS("skylands"),
  WORLD_NETHER("world_nether"),
  WORLD_THE_END("world_the_end"),
  CREATIVE("creative"),
  ARENA("arena"),
  RWF("rwf"),
  OTHER("other");

  private final String wire;

  WorldBucket(String wire) {
    this.wire = wire;
  }

  public String wire() {
    return wire;
  }
}

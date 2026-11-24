package com.shepherdjerred.thestorm.stats.domain;

/** Canonical session termination reasons in the ingest-v1 wire contract. */
public enum EndReason {
  DISCONNECT("disconnect"),
  KICK("kick"),
  SHUTDOWN("shutdown"),
  INTERRUPTED("interrupted");

  private final String wire;

  EndReason(String wire) {
    this.wire = wire;
  }

  public String wire() {
    return wire;
  }
}

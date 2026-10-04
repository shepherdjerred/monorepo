package com.shepherdjerred.mcbridge.domain;

/** Request limits; they mirror {@code BRIDGE_LIMITS} in the wire contract. */
public final class Limits {
  /** Largest request body accepted. */
  public static final int MAX_BODY_BYTES = 32 * 1024 * 1024;

  /** Largest region read, in blocks. */
  public static final long MAX_READ_VOLUME = 4_000_000L;

  /** Largest snapshot, in blocks. */
  public static final long MAX_SNAPSHOT_VOLUME = 4_000_000L;

  /** Most chunk columns one region read or snapshot may touch. */
  public static final long MAX_CHUNK_COLUMNS = 4_096L;

  /** Most WorldEdit ops per {@code /v1/we/run} request. */
  public static final int MAX_WE_OPS = 64;

  /** Most undo steps per request. */
  public static final int MAX_UNDO_STEPS = 100;

  /** Capacity of the event ring buffer. */
  public static final int EVENT_CAPACITY = 2_000;

  /** Most events returned per {@code /v1/events} page. */
  public static final int MAX_EVENT_PAGE = 500;

  private Limits() {}
}

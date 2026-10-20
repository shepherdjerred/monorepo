package com.shepherdjerred.thestorm.rwf.app;

/**
 * Whether a player may join, watch, queue, or be pulled into a match. Search and Destroy's own
 * lobby and maps are sealed so survival rules stay out; a player already there may still play. A
 * different sealed world, such as creative, may not.
 */
public final class SealedParticipants {

  private SealedParticipants() {}

  public static boolean blocked(boolean worldSealed, boolean rwfWorld) {
    return worldSealed && !rwfWorld;
  }
}

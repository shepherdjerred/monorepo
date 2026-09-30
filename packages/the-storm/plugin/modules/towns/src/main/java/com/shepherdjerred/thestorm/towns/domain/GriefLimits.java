package com.shepherdjerred.thestorm.towns.domain;

/**
 * How far some slow, wide-reaching griefs are kept from land a player has no say over.
 *
 * @param witherBufferChunks how far (in chunks, on both axes) from other people's land a player may
 *     build a wither
 * @param raidRadiusBlocks how far from a raid's centre other people's land stops the raid
 * @param thrownItemMemoryTicks how long a dropped item still counts as its thrower's act; after
 *     that anyone may have moved it, so it counts as coming from where it was dropped
 */
public record GriefLimits(int witherBufferChunks, int raidRadiusBlocks, int thrownItemMemoryTicks) {

  /** The largest wither buffer, so the check around a skull stays cheap. */
  public static final int MAX_WITHER_BUFFER = 16;

  /** The largest raid radius, so the check around a raid stays cheap. */
  public static final int MAX_RAID_RADIUS = 256;

  public GriefLimits {
    if (witherBufferChunks < 0 || witherBufferChunks > MAX_WITHER_BUFFER) {
      throw new IllegalArgumentException(
          "witherBufferChunks must be between 0 and " + MAX_WITHER_BUFFER);
    }
    if (raidRadiusBlocks < 0 || raidRadiusBlocks > MAX_RAID_RADIUS) {
      throw new IllegalArgumentException(
          "raidRadiusBlocks must be between 0 and " + MAX_RAID_RADIUS);
    }
    if (thrownItemMemoryTicks < 0) {
      throw new IllegalArgumentException("thrownItemMemoryTicks must not be negative");
    }
  }

  /** The raid radius in whole chunks, rounded up. */
  public int raidRadiusChunks() {
    return (raidRadiusBlocks + 15) / 16;
  }
}

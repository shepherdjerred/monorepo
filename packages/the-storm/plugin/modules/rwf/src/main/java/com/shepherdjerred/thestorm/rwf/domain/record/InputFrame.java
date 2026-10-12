package com.shepherdjerred.thestorm.rwf.domain.record;

/**
 * What a human was pressing and where they were looking in one tick: the movement keys the client
 * last reported and their exact rotation, so a recording can teach the controls behind a movement,
 * not only the movement. Humans only, every tick; bots have intents instead.
 *
 * @param tick ticks since the match went live
 * @param pseudonym who
 * @param keys {@link #FORWARD}, {@link #BACKWARD}, {@link #LEFT}, {@link #RIGHT}, {@link #JUMP},
 *     {@link #SNEAK} and {@link #SPRINT} bits
 * @param yaw hundredths of a degree, 0 to 35999
 * @param pitch hundredths of a degree, -9000 to 9000
 */
public record InputFrame(
    long tick,
    String pseudonym,
    int keys,
    int yaw,
    int pitch,
    boolean attack,
    boolean use,
    int slot,
    long sequence,
    long observationTick,
    Source source) {

  public record Legacy(long tick, String pseudonym, int keys, int yaw, int pitch) {}

  public enum Source {
    HUMAN,
    AUTOMATED,
    MISSING
  }

  /** Legacy recordings contain no attack/use labels. They are never training examples. */
  public InputFrame(Legacy legacy) {
    this(
        legacy.tick(),
        legacy.pseudonym(),
        legacy.keys(),
        legacy.yaw(),
        legacy.pitch(),
        false,
        false,
        0,
        -1,
        -1,
        Source.MISSING);
  }

  public static final int FORWARD = 1;
  public static final int BACKWARD = 2;
  public static final int LEFT = 4;
  public static final int RIGHT = 8;
  public static final int JUMP = 16;
  public static final int SNEAK = 32;
  public static final int SPRINT = 64;

  /** No movement key held: a client's state from login until it reports otherwise. */
  public static final int NONE = 0;

  private static final int ALL_KEYS = 127;
  private static final int CENTIDEGREES = 100;
  private static final int FULL_TURN = 360 * CENTIDEGREES;
  private static final int STRAIGHT = 90 * CENTIDEGREES;

  public InputFrame {
    if (slot < 0
        || slot > 8
        || sequence < -1
        || observationTick < -1
        || observationTick > tick
        || (source == Source.MISSING) != (sequence == -1)) {
      throw new IllegalArgumentException("invalid control provenance, sequence or hotbar slot");
    }
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
    if (!RosterEntry.PSEUDONYM.matcher(pseudonym).matches()) {
      throw new IllegalArgumentException("pseudonym must be short lower-case alphanumeric");
    }
    if (keys < 0 || keys > ALL_KEYS) {
      throw new IllegalArgumentException("keys must be 0-127");
    }
    if (yaw < 0 || yaw >= FULL_TURN || pitch < -STRAIGHT || pitch > STRAIGHT) {
      throw new IllegalArgumentException("yaw must be 0-35999 and pitch -9000..9000");
    }
  }

  /** Degrees to hundredths in 0..35999, wrapping. */
  public static int quantizeYaw(float degrees) {
    return Math.floorMod(Math.round(degrees * CENTIDEGREES), FULL_TURN);
  }

  /** Degrees to hundredths in -9000..9000. */
  public static int quantizePitch(float degrees) {
    return Math.round(Math.max(-90, Math.min(90, degrees)) * CENTIDEGREES);
  }
}

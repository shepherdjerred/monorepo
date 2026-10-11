package com.shepherdjerred.thestorm.client.wire;

import java.nio.ByteBuffer;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Pure codec shared by the native client and disposable fixture, never the production plugin. */
public record DuelMarker(
    UUID match,
    long seed,
    String side,
    String mode,
    String opponent,
    int sequence,
    String marker,
    long tick,
    long worldTick,
    int elapsed,
    String result) {
  public static final String CHANNEL = "thestorm:rwf_duel_clock";
  public static final int VERSION = 1;
  public static final int BYTES = 54;
  public static final int MAXIMUM_ELAPSED = 1200;
  public static final long MAXIMUM_SAFE_INTEGER = 9007199254740991L;
  public static final List<String> SIDES = List.of("red", "blue");
  public static final List<String> MODES = List.of("authored", "external");
  public static final List<String> OPPONENTS =
      List.of(
          "stationary",
          "chase",
          "basic",
          "authored",
          "authored-pressure",
          "authored-patient",
          "historical");
  public static final List<String> MARKERS = List.of("begin", "tick", "terminal");
  public static final List<String> RESULTS =
      List.of("waiting", "live", "win", "loss", "draw", "timeout", "stopped", "cancelled");

  public DuelMarker {
    Objects.requireNonNull(match);
    if (match.equals(new UUID(0, 0))
        || seed < -MAXIMUM_SAFE_INTEGER
        || seed > MAXIMUM_SAFE_INTEGER
        || !SIDES.contains(side)
        || !MODES.contains(mode)
        || !OPPONENTS.contains(opponent)
        || !MARKERS.contains(marker)
        || !RESULTS.contains(result)
        || sequence < 0
        || sequence > MAXIMUM_ELAPSED + 2
        || tick < -1
        || tick > MAXIMUM_SAFE_INTEGER
        || worldTick < 0
        || worldTick > MAXIMUM_SAFE_INTEGER
        || elapsed < -1
        || elapsed > MAXIMUM_ELAPSED) {
      throw new IllegalArgumentException("Invalid duel clock packet");
    }
    switch (marker) {
      case "begin" -> {
        if (sequence != 0 || tick != -1 || elapsed != -1 || !result.equals("waiting"))
          throw new IllegalArgumentException("Invalid duel begin marker");
      }
      case "tick" -> {
        if (tick < 0 || elapsed < 0 || sequence != elapsed + 1 || !result.equals("live"))
          throw new IllegalArgumentException("Invalid duel live marker");
      }
      case "terminal" -> {
        if (sequence != elapsed + 2
            || result.equals("waiting")
            || result.equals("live")
            || (elapsed == -1 && (tick != -1 || !List.of("stopped", "cancelled").contains(result)))
            || (elapsed >= 0 && tick < 0))
          throw new IllegalArgumentException("Invalid duel terminal marker");
      }
      default -> throw new IllegalArgumentException("Unknown duel marker");
    }
  }

  public byte[] encode() {
    return ByteBuffer.allocate(BYTES)
        .put((byte) VERSION)
        .putLong(match.getMostSignificantBits())
        .putLong(match.getLeastSignificantBits())
        .putLong(seed)
        .put((byte) SIDES.indexOf(side))
        .put((byte) MODES.indexOf(mode))
        .put((byte) OPPONENTS.indexOf(opponent))
        .putInt(sequence)
        .put((byte) MARKERS.indexOf(marker))
        .putLong(tick)
        .putLong(worldTick)
        .putInt(elapsed)
        .put((byte) RESULTS.indexOf(result))
        .array();
  }

  public static DuelMarker decode(byte[] bytes) {
    if (bytes.length != BYTES || bytes[0] != VERSION)
      throw new IllegalArgumentException("Invalid duel clock size or version");
    var buffer = ByteBuffer.wrap(bytes);
    buffer.get();
    var match = new UUID(buffer.getLong(), buffer.getLong());
    var seed = buffer.getLong();
    var side = enumeration(buffer, SIDES);
    var mode = enumeration(buffer, MODES);
    var opponent = enumeration(buffer, OPPONENTS);
    var sequence = buffer.getInt();
    var marker = enumeration(buffer, MARKERS);
    var tick = buffer.getLong();
    var worldTick = buffer.getLong();
    var elapsed = buffer.getInt();
    return new DuelMarker(
        match,
        seed,
        side,
        mode,
        opponent,
        sequence,
        marker,
        tick,
        worldTick,
        elapsed,
        enumeration(buffer, RESULTS));
  }

  private static String enumeration(ByteBuffer buffer, List<String> values) {
    var code = Byte.toUnsignedInt(buffer.get());
    if (code >= values.size()) throw new IllegalArgumentException("Unknown duel clock enum");
    return values.get(code);
  }
}

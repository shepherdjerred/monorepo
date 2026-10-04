package com.shepherdjerred.thestorm.rwfbots.domain.record;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;

/**
 * A running 64-bit FNV-1a hash over everything a bot decided and did. Two runs with the same seed
 * and inputs produce the same hash; the hash is a cheap determinism check.
 *
 * @param value the hash so far
 */
public record TraceHash(long value) {

  private static final long OFFSET = 0xcbf29ce484222325L;
  private static final long PRIME = 0x100000001b3L;

  public static final TraceHash EMPTY = new TraceHash(OFFSET);

  public TraceHash add(DecisionTrace trace) {
    var hash = this;
    hash = hash.addLong(trace.bot().value()).addLong(trace.snapshotTick());
    for (var feature : trace.features()) {
      hash = hash.addString(feature.name()).addLong(feature.quantized());
    }
    for (var scored : trace.utilities()) {
      hash = hash.addString(scored.option().name()).addDouble(scored.score());
    }
    return hash.addString(trace.choice().name())
        .addDouble(trace.temperature())
        .addDouble(trace.randomDraw());
  }

  public TraceHash add(Decision decision) {
    var hash = addLong(decision.bot().value()).addString(decision.option().name());
    hash = hash.addString(decision.planLabel()).addLong(decision.snapshotTick());
    for (var waypoint : decision.waypoints()) {
      hash =
          hash.addDouble(waypoint.pos().x())
              .addDouble(waypoint.pos().y())
              .addDouble(waypoint.pos().z());
    }
    return hash;
  }

  public TraceHash add(BodyCommand command) {
    return addString(command.toString());
  }

  public TraceHash addLong(long number) {
    var hash = value;
    for (var i = 0; i < 8; i++) {
      hash = (hash ^ (number >>> (8 * i) & 0xff)) * PRIME;
    }
    return new TraceHash(hash);
  }

  public TraceHash addDouble(double number) {
    return addLong(Double.doubleToLongBits(number));
  }

  public TraceHash addString(String text) {
    var hash = value;
    for (var b : text.getBytes(UTF_8)) {
      hash = (hash ^ (b & 0xff)) * PRIME;
    }
    return new TraceHash(hash);
  }

  /** The hash as sixteen hex digits. */
  public String hex() {
    return String.format("%016x", value);
  }
}

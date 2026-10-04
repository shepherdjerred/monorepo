package com.shepherdjerred.thestorm.rwf.domain.record;

import java.util.List;

/**
 * A whole recorded match: header, events, frames, intents and the end. Flat lists at tick
 * resolution, so a recording can be streamed out as it happens and replayed later.
 *
 * @param header what the recording is of
 * @param events what happened, in tick order
 * @param frames combatant states, in tick order
 * @param intents what bots were trying to do, in tick order
 * @param end how it ended
 */
public record MatchRecord(
    RecordHeader header,
    List<RecordEvent> events,
    List<Frame> frames,
    List<Intent> intents,
    RecordEnd end) {

  /** The current record format. Bump it whenever any record type gains or changes a field. */
  public static final int SCHEMA_VERSION = 1;

  public MatchRecord {
    events = List.copyOf(events);
    frames = List.copyOf(frames);
    intents = List.copyOf(intents);
    if (header.schemaVersion() != SCHEMA_VERSION) {
      throw new IllegalArgumentException(
          "record schema " + header.schemaVersion() + " is not " + SCHEMA_VERSION);
    }
    checkOrdered(events.stream().mapToLong(RecordEvent::tick).toArray(), "events");
    checkOrdered(frames.stream().mapToLong(Frame::tick).toArray(), "frames");
    checkOrdered(intents.stream().mapToLong(Intent::tick).toArray(), "intents");
  }

  private static void checkOrdered(long[] ticks, String what) {
    for (var i = 1; i < ticks.length; i++) {
      if (ticks[i] < ticks[i - 1]) {
        throw new IllegalArgumentException(what + " must be in tick order");
      }
    }
  }
}

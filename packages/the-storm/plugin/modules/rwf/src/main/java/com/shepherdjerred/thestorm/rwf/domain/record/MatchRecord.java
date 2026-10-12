package com.shepherdjerred.thestorm.rwf.domain.record;

import java.util.List;

/**
 * A whole recorded match: header, events, frames, human inputs, observations, intents, the
 * structured occurrences of schema 4 and the end. Flat lists at tick resolution, so a recording can
 * be streamed out as it happens and replayed later.
 *
 * @param header what the recording is of
 * @param events what happened, in tick order
 * @param frames combatant states, in tick order
 * @param inputs humans' keys and exact rotation, in tick order
 * @param intents what bots were trying to do, in tick order
 * @param occurrences kills, the ballot, chat, world changes and pulses, in tick order (schema 4)
 * @param end how it ended
 */
public record MatchRecord(
    RecordHeader header,
    List<RecordEvent> events,
    List<Frame> frames,
    List<InputFrame> inputs,
    List<ObservationFrame> observations,
    List<Intent> intents,
    List<Occurrence> occurrences,
    RecordEnd end) {

  /** The current record format. Bump it whenever any record type gains or changes a field. */
  public static final int SCHEMA_VERSION = 4;

  /** The oldest format still read: version 2 lacks complete controls, 3 lacks occurrences. */
  public static final int OLDEST_READABLE = 2;

  public MatchRecord {
    events = List.copyOf(events);
    frames = List.copyOf(frames);
    inputs = List.copyOf(inputs);
    observations = List.copyOf(observations);
    intents = List.copyOf(intents);
    occurrences = List.copyOf(occurrences);
    if (header.schemaVersion() < OLDEST_READABLE || header.schemaVersion() > SCHEMA_VERSION) {
      throw new IllegalArgumentException("unsupported record schema " + header.schemaVersion());
    }
    if (header.schemaVersion() == 2
        && (!observations.isEmpty()
            || inputs.stream()
                .anyMatch(
                    input ->
                        !input.equals(
                            new InputFrame(
                                new InputFrame.Legacy(
                                    input.tick(),
                                    input.pseudonym(),
                                    input.keys(),
                                    input.yaw(),
                                    input.pitch())))))) {
      throw new IllegalArgumentException(
          "schema 2 cannot encode observations or complete controls");
    }
    checkOrdered(events.stream().mapToLong(RecordEvent::tick).toArray(), "events");
    checkOrdered(frames.stream().mapToLong(Frame::tick).toArray(), "frames");
    checkOrdered(inputs.stream().mapToLong(InputFrame::tick).toArray(), "inputs");
    checkOrdered(observations.stream().mapToLong(ObservationFrame::tick).toArray(), "observations");
    checkOrdered(intents.stream().mapToLong(Intent::tick).toArray(), "intents");
    checkOrdered(occurrences.stream().mapToLong(Occurrence::tick).toArray(), "occurrences");
    if (header.schemaVersion() < 4 && !occurrences.isEmpty()) {
      throw new IllegalArgumentException(
          "schema " + header.schemaVersion() + " cannot encode occurrences");
    }
    for (var occurrence : occurrences) {
      if (occurrence instanceof Occurrence.Chat chat
          && chat.text().isPresent()
          && header.roster().stream()
              .noneMatch(entry -> entry.bot() && entry.pseudonym().equals(chat.speaker()))) {
        throw new IllegalArgumentException("only a rostered bot's chat is recorded as text");
      }
    }
  }

  /** Whether {@code version} is a format this build reads. */
  public static boolean readable(long version) {
    return version >= OLDEST_READABLE && version <= SCHEMA_VERSION;
  }

  private static void checkOrdered(long[] ticks, String what) {
    for (var i = 1; i < ticks.length; i++) {
      if (ticks[i] < ticks[i - 1]) {
        throw new IllegalArgumentException(what + " must be in tick order");
      }
    }
  }
}

package com.shepherdjerred.thestorm.rwf.domain.record;

/**
 * Something that happened, at tick resolution.
 *
 * @param tick ticks since the match went live
 * @param kind a short kind such as {@code died}, {@code armed}, {@code defused}, {@code exploded}
 * @param subject the pseudonym or bomb id it happened to
 * @param detail free text such as the killer's pseudonym or the attack type; may be empty
 */
public record RecordEvent(long tick, String kind, String subject, String detail) {

  public RecordEvent {
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
    if (kind.isBlank() || subject.isBlank()) {
      throw new IllegalArgumentException("kind and subject must not be blank");
    }
  }
}

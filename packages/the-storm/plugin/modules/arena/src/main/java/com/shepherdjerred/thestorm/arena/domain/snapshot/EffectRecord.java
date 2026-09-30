package com.shepherdjerred.thestorm.arena.domain.snapshot;

/**
 * One active potion effect.
 *
 * @param type the effect key, such as {@code minecraft:speed}
 * @param amplifier 0 is level I
 * @param duration ticks left; -1 is infinite
 * @param ambient whether it came from a beacon
 * @param particles whether it shows particles
 * @param icon whether it shows an icon
 */
public record EffectRecord(
    String type, int amplifier, int duration, boolean ambient, boolean particles, boolean icon) {

  public EffectRecord {
    if (type.isBlank()) {
      throw new IllegalArgumentException("type must not be blank");
    }
    if (duration < -1) {
      throw new IllegalArgumentException("duration must be -1 (infinite) or more: " + duration);
    }
  }
}

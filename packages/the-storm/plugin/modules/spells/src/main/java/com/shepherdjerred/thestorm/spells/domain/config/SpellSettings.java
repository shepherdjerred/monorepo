package com.shepherdjerred.thestorm.spells.domain.config;

import java.util.List;

/**
 * Each spell's own numbers, under {@code settings:} in its entry. Ranges are in blocks, durations
 * in seconds (Dawn and Dusk: minutes), damage in half-hearts, velocities in blocks per tick.
 */
public final class SpellSettings {

  /** The longest effect any spell may have, in seconds. */
  static final int MAX_SECONDS = 600;

  /** The farthest any spell may reach, in blocks. */
  static final double MAX_RANGE = 64;

  private SpellSettings() {}

  /** A spell with nothing to tune. */
  public record None() {}

  /** Recall: how far from the Mark to look for a safe spot. */
  public record Search(int searchRadius) {
    public Search {
      Checks.between("searchRadius", searchRadius, 0, 8);
    }
  }

  /** Haste: potion strength (0 = level I) and duration. */
  public record Buff(int durationSeconds, int amplifier) {
    public Buff {
      Checks.between("durationSeconds", durationSeconds, 1, MAX_SECONDS);
      Checks.between("amplifier", amplifier, 0, 4);
    }
  }

  /** A timed effect on the caster (Stealth). */
  public record Timed(int durationSeconds) {
    public Timed {
      Checks.between("durationSeconds", durationSeconds, 1, MAX_SECONDS);
    }
  }

  /** Fire Nova: burns and hurts every creature around the caster. */
  public record Nova(double radius, double damage, int fireSeconds) {
    public Nova {
      Checks.between("radius", radius, 1, 16);
      Checks.between("damage", damage, 0, 40);
      Checks.between("fireSeconds", fireSeconds, 0, 30);
    }
  }

  /** Cripple: slows and weakens the creature in sight. */
  public record Afflict(double range, int durationSeconds, int amplifier) {
    public Afflict {
      Checks.between("range", range, 1, MAX_RANGE);
      Checks.between("durationSeconds", durationSeconds, 1, MAX_SECONDS);
      Checks.between("amplifier", amplifier, 0, 4);
    }
  }

  /** A radius around the caster (Confusion, Roar, Dowse). */
  public record Radius(double radius) {
    public Radius {
      Checks.between("radius", radius, 1, 32);
    }
  }

  /** A timed effect on the creature in sight (Silence). */
  public record Targeted(double range, int durationSeconds) {
    public Targeted {
      Checks.between("range", range, 1, MAX_RANGE);
      Checks.between("durationSeconds", durationSeconds, 1, MAX_SECONDS);
    }
  }

  /** How far a spell reaches (Disarm, Shadowstep, Blink). */
  public record Range(double range) {
    public Range {
      Checks.between("range", range, 1, MAX_RANGE);
    }
  }

  /** Phase: how far through a wall the caster may step. */
  public record Phase(int reach) {
    public Phase {
      Checks.between("reach", reach, 2, 16);
    }
  }

  /** Wall: a temporary wall where the caster looks. */
  public record Wall(double range, int width, int height, int durationSeconds, String material) {
    public Wall {
      Checks.between("range", range, 1, MAX_RANGE);
      Checks.between("width", width, 1, 9);
      Checks.between("height", height, 1, 6);
      Checks.between("durationSeconds", durationSeconds, 1, 120);
      Checks.upperName("material", material);
    }
  }

  /** Geyser: throws the creature in sight into the air. */
  public record Geyser(double range, double lift, double damage) {
    public Geyser {
      Checks.between("range", range, 1, MAX_RANGE);
      Checks.between("lift", lift, 0.1, 3);
      Checks.between("damage", damage, 0, 40);
    }
  }

  /** Farm: grows crops around the caster. */
  public record Farm(int radius, int stages) {
    public Farm {
      Checks.between("radius", radius, 1, 12);
      Checks.between("stages", stages, 1, 7);
    }
  }

  /** Force Push: shoves every creature around the caster away. */
  public record Push(double radius, double strength, double lift) {
    public Push {
      Checks.between("radius", radius, 1, 16);
      Checks.between("strength", strength, 0.1, 4);
      Checks.between("lift", lift, 0, 2);
    }
  }

  /** Divine: senses the nearest of {@code blocks} within {@code radius}. */
  public record Divine(int radius, List<String> blocks) {
    public Divine {
      Checks.between("radius", radius, 1, 24);
      if (blocks.isEmpty()) {
        throw new IllegalArgumentException("blocks must name at least one block");
      }
      blocks.forEach(block -> Checks.upperName("blocks", block));
      blocks = List.copyOf(blocks);
    }
  }

  /** Leap: a launch along the caster's heading. */
  public record Leap(double forward, double upward) {
    public Leap {
      Checks.between("forward", forward, 0, 4);
      Checks.between("upward", upward, 0, 3);
    }
  }

  /** Dawn and Dusk: the caster's sky shows {@code targetTime} for a while. */
  public record TimeShift(long targetTime, int durationMinutes) {
    public TimeShift {
      if (targetTime < 0 || targetTime >= 24_000) {
        throw new IllegalArgumentException("targetTime must be 0..23999: " + targetTime);
      }
      Checks.between("durationMinutes", durationMinutes, 1, 120);
    }
  }

  /** Freeze: freezes the creature in sight and ices still water around it. */
  public record Freeze(double range, int durationSeconds, int iceRadius, String iceMaterial) {
    public Freeze {
      Checks.between("range", range, 1, MAX_RANGE);
      Checks.between("durationSeconds", durationSeconds, 1, 60);
      Checks.between("iceRadius", iceRadius, 0, 6);
      Checks.upperName("iceMaterial", iceMaterial);
    }
  }

  /** Drain Life: hurts the creature in sight and heals the caster by part of it. */
  public record Drain(double range, double damage, double healRatio) {
    public Drain {
      Checks.between("range", range, 1, MAX_RANGE);
      Checks.between("damage", damage, 0.5, 40);
      Checks.between("healRatio", healRatio, 0, 1);
    }
  }

  /** Carpet: a brief cloud platform under the caster. */
  public record Carpet(int size, int durationSeconds, String material) {
    public Carpet {
      Checks.between("size", size, 1, 7);
      if (size % 2 == 0) {
        throw new IllegalArgumentException("size must be odd: " + size);
      }
      Checks.between("durationSeconds", durationSeconds, 1, 120);
      Checks.upperName("material", material);
    }
  }

  /** Entomb: seals the creature in sight in temporary blocks. */
  public record Entomb(double range, int durationSeconds, String material) {
    public Entomb {
      Checks.between("range", range, 1, MAX_RANGE);
      Checks.between("durationSeconds", durationSeconds, 1, 30);
      Checks.upperName("material", material);
    }
  }

  /** Damage to every creature of a kind around the caster (Purge). */
  public record AreaDamage(double radius, double damage) {
    public AreaDamage {
      Checks.between("radius", radius, 1, 32);
      Checks.between("damage", damage, 0.5, 100);
    }
  }

  /** Storm Call: lightning where the caster looks; it only hurts under an open, rainy sky. */
  public record StormCall(double range, double radius, double damage, int fireSeconds) {
    public StormCall {
      Checks.between("range", range, 1, MAX_RANGE);
      Checks.between("radius", radius, 0.5, 6);
      Checks.between("damage", damage, 0, 40);
      Checks.between("fireSeconds", fireSeconds, 0, 30);
    }
  }

  /** Ward: a bubble hostile creatures are pushed out of. */
  public record Ward(double radius, int durationSeconds, double pushStrength) {
    public Ward {
      Checks.between("radius", radius, 1, 16);
      Checks.between("durationSeconds", durationSeconds, 1, MAX_SECONDS);
      Checks.between("pushStrength", pushStrength, 0.1, 3);
    }
  }

  /** Thunderclap: a shockwave around the caster. */
  public record Thunderclap(double radius, double damage, double knockback) {
    public Thunderclap {
      Checks.between("radius", radius, 1, 16);
      Checks.between("damage", damage, 0, 40);
      Checks.between("knockback", knockback, 0, 4);
    }
  }

  /** Chain Lightning: strikes the creature in sight and jumps to others. */
  public record Chain(
      double range, double jumpRange, int maxTargets, double damage, double falloff) {
    public Chain {
      Checks.between("range", range, 1, MAX_RANGE);
      Checks.between("jumpRange", jumpRange, 1, 16);
      Checks.between("maxTargets", maxTargets, 1, 12);
      Checks.between("damage", damage, 0.5, 40);
      Checks.between("falloff", falloff, 0.1, 1);
    }
  }
}

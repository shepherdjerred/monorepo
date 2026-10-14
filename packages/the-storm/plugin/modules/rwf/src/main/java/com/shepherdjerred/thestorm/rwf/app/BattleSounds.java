package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The shared audible battlefield: ordered events, including distinct sounds at the same instant.
 */
public interface BattleSounds {
  enum Kind {
    STEP,
    LAND,
    SPLASH,
    MELEE,
    BOW,
    HURT,
    EAT,
    FUSE,
    CHAT
  }

  record Sound(
      UUID world, UUID source, Point position, Kind kind, double radius, Optional<UUID> victim) {
    public Sound {
      if (!(radius > 0) || !Double.isFinite(radius))
        throw new IllegalArgumentException("a sound needs a finite positive radius");
    }
  }

  record Cue(long sequence, Sound sound, Instant at) {}

  Cue emit(Sound sound);

  /**
   * Retained sounds strictly after this cursor, in sequence order. Readers keep their own cursor.
   */
  List<Cue> since(long sequence);
}

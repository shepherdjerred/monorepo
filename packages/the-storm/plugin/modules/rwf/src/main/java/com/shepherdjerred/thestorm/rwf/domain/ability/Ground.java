package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;

/**
 * What the map's blocks say about a spot, as the server reads them for one tick: whether someone
 * sent there would land safely. Abilities that remember places (the Rewind trail) ask again each
 * tick, because craters and barricades change the ground under an old spot.
 */
@FunctionalInterface
public interface Ground {

  /** No ground was read for this event; asking is a bug in whoever built it. */
  Ground UNREAD =
      feet -> {
        throw new IllegalStateException("no ground was read for this event");
      };

  /** Whether someone with their feet at {@code feet} would land safely there. */
  boolean safe(Vec3 feet);
}

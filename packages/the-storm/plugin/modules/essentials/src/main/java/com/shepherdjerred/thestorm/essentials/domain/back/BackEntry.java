package com.shepherdjerred.thestorm.essentials.domain.back;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Instant;

/**
 * A place a player left.
 *
 * @param position where they were
 * @param cause why they left it
 * @param at when
 */
public record BackEntry(Position position, Cause cause, Instant at) {

  /** Why a player left a place. */
  public enum Cause {
    /** They teleported away. */
    TELEPORT,
    /** They died there. */
    DEATH
  }
}

// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/TeamBomb.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.bomb;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Instant;
import java.util.List;

/** Where a bomb is in its life. */
public sealed interface BombState {

  /** The attempts under way on the bomb, valid or not. */
  List<ArmAttempt> attempts();

  /**
   * A TNT block waiting to be armed, perhaps with teams arming it.
   *
   * @param attempts arming attempts, one per team
   */
  record Idle(List<ArmAttempt> attempts) implements BombState {

    public static final Idle EMPTY = new Idle(List.of());

    public Idle {
      attempts = List.copyOf(attempts);
    }
  }

  /**
   * Primed TNT counting down, perhaps with teams defusing it.
   *
   * @param team the team the bomb belongs to now: its owner, or the team that armed a nuke
   * @param fusedAt when it was armed
   * @param remaining seconds left before it explodes
   * @param attempts defusing attempts, one per team
   */
  record Armed(TeamColor team, Instant fusedAt, int remaining, List<ArmAttempt> attempts)
      implements BombState {

    public Armed {
      if (remaining < 0 || remaining > Bomb.FUSE_SECONDS) {
        throw new IllegalArgumentException("remaining must be 0-" + Bomb.FUSE_SECONDS);
      }
      attempts = List.copyOf(attempts);
    }
  }

  /** Exploded or removed; the block is gone for the rest of the match. */
  record Destroyed() implements BombState {

    @Override
    public List<ArmAttempt> attempts() {
      return List.of();
    }
  }
}

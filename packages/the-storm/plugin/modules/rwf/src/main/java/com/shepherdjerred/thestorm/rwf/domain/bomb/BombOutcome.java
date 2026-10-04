// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/TeamBomb.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.bomb;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.List;

/** Something a bomb did in response to a click or a tick, for the match to announce and act on. */
public sealed interface BombOutcome {

  /**
   * A team finished arming the bomb; the TNT is primed.
   *
   * @param by the team
   * @param armers everyone on the team who clicked
   */
  record Armed(TeamColor by, List<CombatantId> armers) implements BombOutcome {

    public Armed {
      armers = List.copyOf(armers);
    }
  }

  /**
   * A team finished defusing the bomb; the TNT block is back and the fuse reset.
   *
   * @param by the team
   * @param defusers everyone on the team who clicked
   */
  record Defused(TeamColor by, List<CombatantId> defusers) implements BombOutcome {

    public Defused {
      defusers = List.copyOf(defusers);
    }
  }

  /**
   * A second of the fuse burned away.
   *
   * @param remaining seconds left
   * @param announced whether Red Warfare announced this second (30, 20, 10 and every second from 5)
   */
  record Burned(int remaining, boolean announced) implements BombOutcome {}

  /** The fuse ran out; the match must explode the bomb. */
  record Exploded() implements BombOutcome {}
}

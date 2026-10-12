package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.Optional;
import java.util.Set;

/**
 * The Saboteur, a quiet bomber. While its team (with a Saboteur alive) arms a bomb, everyone else
 * sees only that the bomb is being worked on: neither the arming progress nor, once armed, the
 * seconds left until there are {@link #REVEAL} or fewer. Its own team sees everything. (Its Bomb
 * Arming III fuse is part of its kit.)
 */
public final class Saboteur implements Ability {

  public static final String ID = "saboteur";

  /** From this many seconds left, an armed bomb's countdown shows to everyone. */
  public static final int REVEAL = 10;

  @Override
  public String id() {
    return ID;
  }

  /**
   * Whether {@code viewer} must not see {@code view}'s progress.
   *
   * @param view the bomb as the match shows it
   * @param armer the team that armed it, once armed (the last team seen arming it)
   * @param viewer the team of whoever looks
   * @param sabotaging the teams with a Saboteur alive
   */
  public static boolean hides(
      MatchSnapshot.BombView view,
      Optional<TeamColor> armer,
      TeamColor viewer,
      Set<TeamColor> sabotaging) {
    return switch (view.state()) {
      case MatchSnapshot.BombView.State.Arming arming ->
          sabotaging.contains(arming.team()) && arming.team() != viewer;
      case MatchSnapshot.BombView.State.Armed armed ->
          armed.defusing().isEmpty()
              && armed.remaining() > REVEAL
              && armer.filter(sabotaging::contains).filter(team -> team != viewer).isPresent();
      case MatchSnapshot.BombView.State.Idle _, MatchSnapshot.BombView.State.Destroyed _ -> false;
    };
  }
}

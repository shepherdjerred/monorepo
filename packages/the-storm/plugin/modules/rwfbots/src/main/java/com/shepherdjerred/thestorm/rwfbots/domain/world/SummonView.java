package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/**
 * One killstreak creature as the server knows it this tick: an attack dog or the iron golem
 * fighting for a team. Perception decides whether a bot sees it.
 *
 * @param id its id, from the same space as combatants' so a hit can name it
 * @param kind what it is
 * @param team the team it fights for
 * @param pos its feet
 * @param vel its motion per tick
 * @param health its health points
 */
public record SummonView(
    CombatantId id, Kind kind, TeamId team, Vec3 pos, Vec3 vel, double health) {

  /** What a summon is, and how a bot should treat it. */
  public enum Kind {
    /**
     * The iron golem: 13 or 14 damage a blow, 40 health, slow. Nobody trades blows with it; a bot
     * keeps out of its reach and an archer shoots it.
     */
    GOLEM(2.7),
    /** An attack dog: 6 damage a bite, 14 health, fast. A bot fights one that closes. */
    WOLF(0.85);

    private final double height;

    Kind(double height) {
      this.height = height;
    }

    /** How tall it stands, in blocks. */
    public double height() {
      return height;
    }
  }

  public SummonView {
    if (!Double.isFinite(health) || health < 0) {
      throw new IllegalArgumentException("health must be finite and not negative: " + health);
    }
  }

  /** The middle of its body, where a bot looks and aims. */
  public Vec3 centre() {
    return pos.plus(0, kind.height() / 2, 0);
  }

  /** Whether it fights against {@code team}. */
  public boolean hostileTo(TeamId team) {
    return !this.team.equals(team);
  }

  /**
   * The creature as a body to fight in the reflex layer, which aims, swings, shoots and steps
   * against a player-shaped body at its position with its motion. Only the reflex layer uses this;
   * the server checks the real creature's reach and sight when the blow is asked for.
   */
  public CombatantView asTarget() {
    return new CombatantView(
        id,
        team,
        false,
        Kit.TROOPER,
        true,
        pos,
        vel,
        0,
        0,
        Math.min(health, CombatantView.MAX_HEALTH),
        0,
        0,
        0,
        false,
        true,
        false,
        false,
        -1,
        TraversalState.UNMODIFIED,
        Quiver.ENDLESS,
        false,
        false,
        false);
  }
}

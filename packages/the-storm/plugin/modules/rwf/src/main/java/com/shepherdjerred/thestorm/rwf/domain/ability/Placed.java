package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Something a kit put in the world: a landmine, a teleporter, a banner, a barricade. The match
 * keeps them so the rules can answer who stepped on what, and so every one is gone at reset.
 */
public sealed interface Placed {

  /** Whose it is. */
  CombatantId owner();

  /** The blocks it occupies. */
  List<BlockPos> blocks();

  /**
   * A Demolitions landmine.
   *
   * @param owner whose
   * @param block the pressure plate
   * @param placedAt when it was set
   * @param armedAt when it armed, two seconds later
   * @param triggeredAt when an enemy stepped on it; it explodes 0.7 seconds after
   */
  record Mine(
      CombatantId owner,
      BlockPos block,
      Instant placedAt,
      Optional<Instant> armedAt,
      Optional<Instant> triggeredAt)
      implements Placed {

    @Override
    public List<BlockPos> blocks() {
      return List.of(block);
    }
  }

  /**
   * A teleporter.
   *
   * @param owner the Teleporter who placed it
   * @param team their team, who may use it
   * @param block the block it turned into
   * @param unstableUntil a remote teleporter cannot be used until then
   */
  record Teleporter(
      CombatantId owner, TeamColor team, BlockPos block, Optional<Instant> unstableUntil)
      implements Placed {

    @Override
    public List<BlockPos> blocks() {
      return List.of(block);
    }

    public boolean unstable(Instant now) {
      return unstableUntil.filter(until -> !now.isAfter(until)).isPresent();
    }
  }

  /**
   * A Bannerman's banner.
   *
   * @param owner whose
   * @param team whose team it heals
   * @param block where it stands
   * @param strikesLeft how many more enemy strikes it takes
   */
  record Banner(CombatantId owner, TeamColor team, BlockPos block, int strikesLeft)
      implements Placed {

    @Override
    public List<BlockPos> blocks() {
      return List.of(block);
    }
  }

  /**
   * An Engineer's barricade.
   *
   * @param owner whose
   * @param blocks the wall
   * @param until when it crumbles
   */
  record Barricade(CombatantId owner, List<BlockPos> blocks, Instant until) implements Placed {

    public Barricade {
      blocks = List.copyOf(blocks);
    }
  }
}

package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/**
 * One bomb this tick.
 *
 * @param id which bomb
 * @param owner whose team dies if it explodes, or a nuke
 * @param pos the block center of the TNT
 * @param state what it is doing
 */
public record BombView(BombId id, BombOwner owner, Vec3 pos, BombState state) {

  /** Whether {@code team}'s players die when this explodes. */
  public boolean belongsTo(TeamId team) {
    return owner.isTeam(team);
  }

  /** Whether {@code team} can arm this: an unlit bomb not their own that is still standing. */
  public boolean armableBy(TeamId team) {
    return !belongsTo(team) && !state.isLit() && !(state instanceof BombState.Destroyed);
  }
}

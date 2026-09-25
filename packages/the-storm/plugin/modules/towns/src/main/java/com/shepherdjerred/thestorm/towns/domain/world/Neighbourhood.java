package com.shepherdjerred.thestorm.towns.domain.world;

import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimMap;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Owner;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLevel;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLookup;
import java.util.Optional;
import java.util.UUID;

/**
 * Land near a chunk that {@code player} has no say over. Things that wander and destroy, such as a
 * wither, may not be made within reach of other people's land.
 */
public final class Neighbourhood {

  private static final Act BUILD = new Act(Action.BUILD, Subject.BLOCK);

  private final ClaimMap map;
  private final TrustLookup trust;

  public Neighbourhood(ClaimMap map, TrustLookup trust) {
    this.map = map;
    this.trust = trust;
  }

  /**
   * The first admin region, or town claim where {@code player} is an outsider, within {@code
   * radius} chunks (on both axes) of {@code center}; empty when there is none.
   */
  public Optional<Owner> foreignLandNear(UUID player, ChunkPos center, int radius) {
    for (var chunk : center.square(radius)) {
      var region = map.regionOverlapping(chunk);
      if (region.isPresent()) {
        return Optional.of(region.get().owner());
      }
      var claim = map.claimAt(chunk);
      if (claim.isPresent() && trust.trustOf(player, claim.get(), BUILD) == TrustLevel.OUTSIDER) {
        return Optional.of(claim.get().owner());
      }
    }
    return Optional.empty();
  }
}

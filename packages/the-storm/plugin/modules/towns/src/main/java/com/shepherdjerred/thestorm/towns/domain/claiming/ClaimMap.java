package com.shepherdjerred.thestorm.towns.domain.claiming;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import java.util.Optional;
import java.util.UUID;

/** A read-only view of the current claims and regions, which claim rules check against. */
public interface ClaimMap {

  Optional<Claim> claimAt(ChunkPos chunk);

  int claimCount(UUID townId);

  /** The admin region overlapping any part of {@code chunk}, if one does. */
  Optional<AdminRegion> regionOverlapping(ChunkPos chunk);
}

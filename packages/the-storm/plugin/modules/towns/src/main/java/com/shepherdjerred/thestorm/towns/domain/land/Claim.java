package com.shepherdjerred.thestorm.towns.domain.land;

import java.util.UUID;

/**
 * One chunk claimed by a town.
 *
 * @param chunk the claimed chunk
 * @param townId the owning town
 * @param flags what the claim allows beyond the town's own members
 */
public record Claim(ChunkPos chunk, UUID townId, ClaimFlags flags) {

  public Owner.OfTown owner() {
    return new Owner.OfTown(townId);
  }

  /** A copy with {@code flag} switched to {@code on}. */
  public Claim withFlag(ClaimFlag flag, boolean on) {
    return new Claim(chunk, townId, flags.with(flag, on));
  }
}

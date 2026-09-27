package com.shepherdjerred.thestorm.towns.domain.land;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * One chunk claimed by a town.
 *
 * @param chunk the claimed chunk
 * @param townId the owning town
 * @param flags what the claim allows beyond the town's own members
 * @param trusted players outside the town who may build, open and use switches on this chunk
 */
public record Claim(ChunkPos chunk, UUID townId, ClaimFlags flags, Set<UUID> trusted) {

  public Claim {
    trusted = Set.copyOf(trusted);
  }

  /** A claim nobody outside the town is trusted on. */
  public Claim(ChunkPos chunk, UUID townId, ClaimFlags flags) {
    this(chunk, townId, flags, Set.of());
  }

  public Owner.OfTown owner() {
    return new Owner.OfTown(townId);
  }

  /** A copy with {@code flag} switched to {@code on}. */
  public Claim withFlag(ClaimFlag flag, boolean on) {
    return new Claim(chunk, townId, flags.with(flag, on), trusted);
  }

  /** A copy that trusts {@code player} when {@code on}, or no longer does. */
  public Claim withTrust(UUID player, boolean on) {
    var next = new HashSet<>(trusted);
    if (on) {
      next.add(player);
    } else {
      next.remove(player);
    }
    return new Claim(chunk, townId, flags, next);
  }
}

package com.shepherdjerred.thestorm.towns.domain.land;

import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * One chunk claimed by a town.
 *
 * @param chunk the claimed chunk
 * @param townId the owning town
 * @param flags what the claim allows beyond the town's own members
 * @param trusted players outside the town who may build, open and use switches on this chunk
 * @param resident the member who alone may build on this chunk; empty when the whole group may
 */
public record Claim(
    ChunkPos chunk, UUID townId, ClaimFlags flags, Set<UUID> trusted, Optional<UUID> resident) {

  public Claim {
    trusted = Set.copyOf(trusted);
  }

  /** A claim nobody outside the town is trusted on, shared by the whole group. */
  public Claim(ChunkPos chunk, UUID townId, ClaimFlags flags) {
    this(chunk, townId, flags, Set.of(), Optional.empty());
  }

  /** A claim shared by the whole group. */
  public Claim(ChunkPos chunk, UUID townId, ClaimFlags flags, Set<UUID> trusted) {
    this(chunk, townId, flags, trusted, Optional.empty());
  }

  public Owner.OfTown owner() {
    return new Owner.OfTown(townId);
  }

  /** A copy with {@code flag} switched to {@code on}. */
  public Claim withFlag(ClaimFlag flag, boolean on) {
    return new Claim(chunk, townId, flags.with(flag, on), trusted, resident);
  }

  /** A copy that trusts {@code player} when {@code on}, or no longer does. */
  public Claim withTrust(UUID player, boolean on) {
    var next = new HashSet<>(trusted);
    if (on) {
      next.add(player);
    } else {
      next.remove(player);
    }
    return new Claim(chunk, townId, flags, next, resident);
  }

  /** A copy whose resident is {@code player}, or the whole group when empty. */
  public Claim withResident(Optional<UUID> player) {
    return new Claim(chunk, townId, flags, trusted, player);
  }
}

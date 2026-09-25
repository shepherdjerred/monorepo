package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimMap;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLevel;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLookup;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownDirectory;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Every town, member and claim, in memory. Protection checks read it on the main thread for every
 * block event, so resolving a position is a few hash lookups with no allocation for claimed land.
 *
 * <p>Main thread only. It enforces its own invariants and throws when handed data that breaks them:
 * one town per player, unique names, claims only for existing towns, one claim per chunk.
 */
public final class TownsState implements ClaimMap, TownDirectory, TrustLookup {

  private static final Land WILDERNESS = new Land.Wilderness();

  private final RegionIndex regions;
  private final Map<String, Land.RegionLand> regionLands = new HashMap<>();
  private final Map<UUID, Town> towns = new HashMap<>();
  private final Map<UUID, UUID> townOfPlayer = new HashMap<>();
  private final Map<String, UUID> townByName = new HashMap<>();
  private final Map<String, Map<Long, Land.TownLand>> claims = new HashMap<>();
  private final Map<UUID, Integer> claimCounts = new HashMap<>();

  public TownsState(RegionIndex regions) {
    this.regions = regions;
    for (var region : regions.all()) {
      regionLands.put(region.id(), new Land.RegionLand(region));
    }
  }

  /** Loads {@code snapshot} into an empty state. */
  public void load(TownsSnapshot snapshot) {
    if (!towns.isEmpty() || !claims.isEmpty()) {
      throw new IllegalStateException("towns are already loaded");
    }
    snapshot.towns().forEach(this::addTown);
    snapshot.claims().forEach(this::addClaim);
  }

  public RegionIndex regions() {
    return regions;
  }

  /** What block ({@code x}, {@code y}, {@code z}) of {@code world} is: region, claim or wild. */
  public Land landAt(String world, int x, int y, int z) {
    var region = regions.at(world, x, y, z);
    if (region.isPresent()) {
      return regionLand(region.get());
    }
    var worldClaims = claims.get(world);
    if (worldClaims == null) {
      return WILDERNESS;
    }
    var claim = worldClaims.get(ChunkPos.key(x >> 4, z >> 4));
    return claim == null ? WILDERNESS : claim;
  }

  private Land.RegionLand regionLand(AdminRegion region) {
    var land = regionLands.get(region.id());
    if (land == null) {
      throw new IllegalStateException("region " + region.id() + " is not indexed");
    }
    return land;
  }

  @Override
  public Optional<Claim> claimAt(ChunkPos chunk) {
    var worldClaims = claims.get(chunk.world());
    if (worldClaims == null) {
      return Optional.empty();
    }
    return Optional.ofNullable(worldClaims.get(chunk.key())).map(Land.TownLand::claim);
  }

  @Override
  public int claimCount(UUID townId) {
    return claimCounts.getOrDefault(townId, 0);
  }

  @Override
  public Optional<AdminRegion> regionOverlapping(ChunkPos chunk) {
    return regions.overlapping(chunk);
  }

  @Override
  public Optional<Town> townOf(UUID player) {
    return Optional.ofNullable(townOfPlayer.get(player)).map(towns::get);
  }

  @Override
  public Optional<Town> named(String name) {
    return Optional.ofNullable(townByName.get(name.toLowerCase(Locale.ROOT))).map(towns::get);
  }

  public Optional<Town> town(UUID townId) {
    return Optional.ofNullable(towns.get(townId));
  }

  public Collection<Town> towns() {
    return List.copyOf(towns.values());
  }

  /** Every claim {@code townId} holds. */
  public List<Claim> claimsOf(UUID townId) {
    var held = new ArrayList<Claim>();
    for (var worldClaims : claims.values()) {
      for (var land : worldClaims.values()) {
        if (land.claim().townId().equals(townId)) {
          held.add(land.claim());
        }
      }
    }
    return List.copyOf(held);
  }

  @Override
  public TrustLevel trustOf(UUID player, UUID townId) {
    var town = towns.get(townId);
    if (town == null) {
      throw new IllegalStateException("claim for unknown town " + townId);
    }
    return town.roleOf(player).map(TownRole::trust).orElse(TrustLevel.OUTSIDER);
  }

  /** Adds a new town; its members must not belong to another town and its name must be free. */
  public void addTown(Town town) {
    if (towns.containsKey(town.id())) {
      throw new IllegalStateException("town " + town.id() + " already exists");
    }
    var key = town.name().toLowerCase(Locale.ROOT);
    if (townByName.containsKey(key)) {
      throw new IllegalStateException("a town is already named " + town.name());
    }
    for (var member : town.members().keySet()) {
      if (townOfPlayer.containsKey(member)) {
        throw new IllegalStateException(member + " already belongs to a town");
      }
    }
    towns.put(town.id(), town);
    townByName.put(key, town.id());
    town.members().keySet().forEach(member -> townOfPlayer.put(member, town.id()));
  }

  /** Removes a town and every claim it holds; returns those claims. */
  public List<Claim> removeTown(UUID townId) {
    var town = towns.remove(townId);
    if (town == null) {
      return List.of();
    }
    townByName.remove(town.name().toLowerCase(Locale.ROOT));
    town.members().keySet().forEach(townOfPlayer::remove);
    var held = claimsOf(townId);
    held.forEach(claim -> removeClaim(claim.chunk()));
    return held;
  }

  /** Adds a claim on a free chunk for an existing town. */
  public void addClaim(Claim claim) {
    if (!towns.containsKey(claim.townId())) {
      throw new IllegalStateException("claim " + claim.chunk() + " for unknown town");
    }
    var worldClaims = claims.computeIfAbsent(claim.chunk().world(), world -> new HashMap<>());
    var key = claim.chunk().key();
    if (worldClaims.containsKey(key)) {
      throw new IllegalStateException("chunk " + claim.chunk() + " is already claimed");
    }
    worldClaims.put(key, new Land.TownLand(claim));
    claimCounts.merge(claim.townId(), 1, Integer::sum);
  }

  /** Replaces an existing claim with the same chunk and town, for flag changes. */
  public void replaceClaim(Claim claim) {
    var current = claimAt(claim.chunk());
    if (current.isEmpty() || !current.get().townId().equals(claim.townId())) {
      throw new IllegalStateException("no claim by that town at " + claim.chunk());
    }
    claims
        .computeIfAbsent(claim.chunk().world(), world -> new HashMap<>())
        .put(claim.chunk().key(), new Land.TownLand(claim));
  }

  /** Removes the claim on {@code chunk}, if any; returns it. */
  public Optional<Claim> removeClaim(ChunkPos chunk) {
    var worldClaims = claims.get(chunk.world());
    if (worldClaims == null) {
      return Optional.empty();
    }
    var removed = worldClaims.remove(chunk.key());
    if (removed == null) {
      return Optional.empty();
    }
    var town = removed.claim().townId();
    var count = claimCounts.getOrDefault(town, 0);
    if (count <= 1) {
      claimCounts.remove(town);
    } else {
      claimCounts.put(town, count - 1);
    }
    return Optional.of(removed.claim());
  }
}

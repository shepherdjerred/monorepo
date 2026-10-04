package com.shepherdjerred.thestorm.towns.domain;

import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimPolicy;
import com.shepherdjerred.thestorm.towns.domain.lock.LockPolicy;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpPolicy;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import com.shepherdjerred.thestorm.towns.domain.town.MembershipPolicy;
import java.util.HashSet;
import java.util.List;

/**
 * {@code plugins/TheStorm/towns.yml}, owned by the repository.
 *
 * @param claims how towns may claim land
 * @param membership how long invitations and handovers stay open
 * @param locks how container locks behave
 * @param pvp how often players may change their own PvP switch
 * @param denialCooldownMillis how long before a player is told about the same denial again
 * @param grief how far wide-reaching griefs (withers, raids) are kept from other people's land
 * @param regions the admin regions; where they overlap, the one listed first wins
 */
public record TownsConfig(
    ClaimPolicy claims,
    MembershipPolicy membership,
    LockPolicy locks,
    PvpPolicy pvp,
    long denialCooldownMillis,
    GriefLimits grief,
    int spawnRadiusBlocks,
    List<AdminRegion> regions) {

  /** The most chunks all regions together may overlap, so the region index stays small. */
  public static final long MAX_REGION_CHUNKS = 65_536;

  public TownsConfig {
    regions = List.copyOf(regions);
    if (spawnRadiusBlocks < 16 || spawnRadiusBlocks > 256) {
      throw new IllegalArgumentException("spawnRadiusBlocks must be between 16 and 256");
    }
    if (denialCooldownMillis < 0) {
      throw new IllegalArgumentException("denialCooldownMillis must not be negative");
    }
    var ids = new HashSet<String>();
    for (var region : regions) {
      if (!ids.add(region.id())) {
        throw new IllegalArgumentException("region id " + region.id() + " is listed twice");
      }
    }
    var chunks =
        regions.stream()
            .flatMap(region -> region.areas().all().stream())
            .mapToLong(area -> area.footprintSize())
            .sum();
    if (chunks > MAX_REGION_CHUNKS) {
      throw new IllegalArgumentException(
          "regions overlap " + chunks + " chunks; at most " + MAX_REGION_CHUNKS + " are allowed");
    }
  }
}

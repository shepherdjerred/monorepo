package com.shepherdjerred.thestorm.towns.domain;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLevel;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLookup;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import com.shepherdjerred.thestorm.towns.domain.region.ChunkCorner;
import com.shepherdjerred.thestorm.towns.domain.region.ChunkRange;
import com.shepherdjerred.thestorm.towns.domain.region.RegionAllowance;
import com.shepherdjerred.thestorm.towns.domain.region.RegionAreas;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Shared towns, players, claims and regions for domain tests. */
public final class Fixtures {

  public static final String WORLD = "world";

  public static final UUID TOWN_A = UUID.fromString("00000000-0000-4000-8000-00000000000a");
  public static final UUID TOWN_B = UUID.fromString("00000000-0000-4000-8000-00000000000b");

  public static final UUID OWNER = UUID.fromString("00000000-0000-4000-8000-000000000001");
  public static final UUID ASSISTANT = UUID.fromString("00000000-0000-4000-8000-000000000002");
  public static final UUID MEMBER = UUID.fromString("00000000-0000-4000-8000-000000000003");

  /** Owns town B, so an outsider to town A. */
  public static final UUID OTHER_TOWN_OWNER =
      UUID.fromString("00000000-0000-4000-8000-000000000004");

  /** In no town at all. */
  public static final UUID NOMAD = UUID.fromString("00000000-0000-4000-8000-000000000005");

  public static final Instant FOUNDED = Instant.parse("2026-09-01T00:00:00Z");

  private Fixtures() {}

  public static Town townA() {
    return new Town(
        TOWN_A,
        "Aegis",
        FOUNDED,
        Map.of(OWNER, TownRole.OWNER, ASSISTANT, TownRole.ASSISTANT, MEMBER, TownRole.MEMBER));
  }

  public static Town townB() {
    return Town.found(TOWN_B, "Bastion", FOUNDED, OTHER_TOWN_OWNER);
  }

  /** Trust as town membership gives it, for towns A and B. */
  public static TrustLookup trust() {
    var towns = List.of(townA(), townB());
    return (player, claim, act) ->
        towns.stream()
            .filter(town -> town.id().equals(claim.townId()))
            .findFirst()
            .orElseThrow()
            .roleOf(player)
            .map(TownRole::trust)
            .orElse(TrustLevel.OUTSIDER);
  }

  public static ChunkPos chunk(int x, int z) {
    return new ChunkPos(WORLD, x, z);
  }

  public static Claim claim(UUID town, int x, int z, ClaimFlag... flags) {
    return new Claim(chunk(x, z), town, ClaimFlags.of(flags));
  }

  public static Land.TownLand land(UUID town, ClaimFlag... flags) {
    return new Land.TownLand(claim(town, 0, 0, flags));
  }

  public static Land.TownLand landWithFlags(UUID town, Set<ClaimFlag> flags) {
    return new Land.TownLand(new Claim(chunk(0, 0), town, new ClaimFlags(flags)));
  }

  /** Every flag except {@code except}. */
  public static Set<ClaimFlag> allFlagsBut(ClaimFlag except) {
    var flags = EnumSet.allOf(ClaimFlag.class);
    flags.remove(except);
    return flags;
  }

  public static AdminRegion region(String id, RegionAllowance... allow) {
    return new AdminRegion(
        id,
        id.substring(0, 1).toUpperCase(java.util.Locale.ROOT) + id.substring(1),
        new RegionAreas(
            List.of(new ChunkRange(WORLD, new ChunkCorner(-2, -2), new ChunkCorner(1, 1))),
            List.of()),
        List.of(allow));
  }

  public static RegionAllowance allow(Action action, Subject... subjects) {
    return new RegionAllowance(action, Set.of(subjects));
  }
}

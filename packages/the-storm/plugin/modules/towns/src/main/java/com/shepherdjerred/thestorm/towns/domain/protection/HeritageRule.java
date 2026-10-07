package com.shepherdjerred.thestorm.towns.domain.protection;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;

/** Intentional editing is restricted to proven owners; ordinary claim flags never grant it. */
final class HeritageRule {
  private static final java.util.Set<Subject> PUBLIC_USES =
      java.util.Set.of(
          Subject.DOOR,
          Subject.TRAPDOOR,
          Subject.FENCE_GATE,
          Subject.BUTTON,
          Subject.LEVER,
          Subject.PRESSURE_PLATE,
          Subject.TRIPWIRE,
          Subject.BELL);

  private HeritageRule() {}

  static Verdict decide(Actor actor, Act act, Land.HeritageLand land) {
    if (land.underlying() instanceof Land.ParcelLand(var parcel)
        && parcel.phase()
            == com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel.Phase.RESETTING) {
      return new Verdict.Deny(new Denial.ByRegion(land.site().name(), act.action()));
    }
    var permitted =
        switch (act.action()) {
          case ATTACK_PLAYER -> land.site().profile() == RegionProfile.ARENA;
          case TELEPORT_INTO -> true;
          case INTERACT -> PUBLIC_USES.contains(act.subject()) || edits(actor, act, land);
          case INTERACT_ENTITY -> act.subject() == Subject.VILLAGER || edits(actor, act, land);
          case BREAK, OPEN_CONTAINER -> arenaUse(act, land) || edits(actor, act, land);
          case BUILD, USE_REDSTONE, DAMAGE_ENTITY, PLACE_ENTITY, SET_HOME ->
              edits(actor, act, land);
        };
    return permitted
        ? Verdict.allow()
        : new Verdict.Deny(
            act.action() == Action.ATTACK_PLAYER
                ? new Denial.NoPvp()
                : new Denial.ByRegion(land.site().name(), act.action()));
  }

  /** The arena module still checks membership and authored loot/heart positions. */
  private static boolean arenaUse(Act act, Land.HeritageLand land) {
    return land.site().profile() == RegionProfile.ARENA
        && (act.action() == Action.OPEN_CONTAINER
            || (act.action() == Action.BREAK && act.subject() == Subject.CREAKING_HEART))
        && land.underlying() instanceof Land.RegionLand(var region)
        && region.profile() == RegionProfile.ARENA
        && region.permits(act);
  }

  private static boolean edits(Actor actor, Act act, Land.HeritageLand land) {
    if (actor.bypass()) return true;
    if (land.editors().contains(actor.player())) return true;
    return land.underlying() instanceof Land.ParcelLand(var parcel)
        && parcel.permits(actor.player(), act);
  }
}

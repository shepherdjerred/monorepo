package com.shepherdjerred.thestorm.towns.domain.world;

import com.shepherdjerred.thestorm.towns.domain.land.Land;

/**
 * Whether a world effect starting on {@code source} may change {@code target}.
 *
 * <ul>
 *   <li>Within one owner's land (or within the wilderness) effects happen, except that explosions,
 *       fire and mob griefing need the claim's flag, and never touch admin regions.
 *   <li>Across owners, an effect may only reach the wilderness; it never reaches a claim or region
 *       it did not start in, whatever that land's flags say.
 *   <li>Item transfers also protect their source: items never leave a claim or region for anyone
 *       else's land, the wilderness included.
 * </ul>
 */
public final class WorldRules {

  private WorldRules() {}

  public static boolean allows(WorldEffect effect, Land source, Land target) {
    if (source instanceof Land.Wilderness && target instanceof Land.Wilderness) {
      return true;
    }
    if (source.sameOwnerAs(target)) {
      return allowedWithin(effect, target);
    }
    if (Containment.takesFromSource(effect) && !(source instanceof Land.Wilderness)) {
      return false;
    }
    return target instanceof Land.Wilderness;
  }

  private static boolean allowedWithin(WorldEffect effect, Land land) {
    var flag = Containment.flagFor(effect);
    return switch (land) {
      case Land.Wilderness _ -> true;
      case Land.TownLand(var claim) -> flag.map(claim.flags()::has).orElse(true);
      case Land.RegionLand _ -> flag.isEmpty();
    };
  }
}

package com.shepherdjerred.thestorm.towns.domain.world;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel;

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
    if (source instanceof Land.HeritageLand || target instanceof Land.HeritageLand) {
      return heritageAllows(effect, source, target);
    }
    if (source instanceof Land.WorkLand || target instanceof Land.WorkLand) {
      return false;
    }
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
      case Land.HeritageLand _ -> false;
      case Land.Wilderness _ -> true;
      case Land.WorkLand _ -> false;
      case Land.TownLand(var claim) -> flag.map(claim.flags()::has).orElse(true);
      case Land.RegionLand _ ->
          flag.isEmpty()
              && switch (effect) {
                case NATURAL_CHANGE,
                    GRASS_REGROWTH,
                    CROP_GROWTH,
                    SOIL_MOISTURE,
                    TREE_GROWTH,
                    BLOCK_SPREAD,
                    SCULK_SPREAD,
                    FALLING_BLOCK,
                    PORTAL_CREATION ->
                    false;
                default -> true;
              };
      case Land.ParcelLand(var parcel) ->
          parcel.phase() == ProtectedParcel.Phase.ACTIVE
              && flag.isEmpty()
              && effect != WorldEffect.NATURAL_CHANGE
              && effect != WorldEffect.CROP_GROWTH
              && effect != WorldEffect.SOIL_MOISTURE
              && effect != WorldEffect.GRASS_REGROWTH
              && effect != WorldEffect.SCULK_SPREAD
              && effect != WorldEffect.PORTAL_CREATION;
    };
  }

  private static boolean heritageAllows(WorldEffect effect, Land source, Land target) {
    if (source instanceof Land.WorkLand || target instanceof Land.WorkLand) return false;
    if (target instanceof Land.HeritageLand) {
      return switch (effect) {
        case GRAZING, GRASS_REGROWTH, CROP_GROWTH, SOIL_MOISTURE -> true;
        case REDSTONE, ITEM_TRANSFER -> source.sameOwnerAs(target);
        default -> false;
      };
    }
    // Neither a piston nor a hopper can remove preserved blocks or private items over the border.
    return switch (effect) {
      case PISTON, ITEM_TRANSFER, DISPENSE -> false;
      default -> target instanceof Land.Wilderness;
    };
  }
}

// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/utils/UtilBlock.java, the solid, partially solid and
// non-solid tables, and UtilLoc.java, isSafeTeleport's pressure plates); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.kit.SafeTeleport.Footing;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.Tag;

/**
 * The original's block tables in today's materials, for the Time Machine's landing check. The
 * original listed every 1.9 block as fully solid (standable), partially solid (standable or not) or
 * non-solid; the materials it named have split and been renamed since, so each table is kept as the
 * families they became:
 *
 * <ul>
 *   <li>{@link Footing#TRAP}: its {@code STONE_PLATE}, {@code WOOD_PLATE}, {@code IRON_PLATE} and
 *       {@code TRIPWIRE}, which are the stone (and polished blackstone) and wooden pressure plates,
 *       the heavy weighted plate and tripwire. The light weighted (gold) plate was non-solid and
 *       not a trap, and still is.
 *   <li>{@link Footing#PARTIAL}: the partially solid blocks it marked not standable.
 *   <li>{@link Footing#STANDABLE}: the partially solid blocks it marked standable, and every fully
 *       solid block.
 *   <li>{@link Footing#CLEAR}: every block without collision not named above.
 * </ul>
 */
final class Footings {

  /** Partially solid, not standable, by the original's table. */
  private static final Set<Material> UNSTANDABLE =
      Set.of(
          Material.WATER,
          Material.LAVA,
          Material.BUBBLE_COLUMN,
          Material.COBWEB,
          Material.PISTON_HEAD,
          Material.MOVING_PISTON,
          Material.LADDER,
          Material.IRON_BARS,
          Material.VINE,
          Material.CAKE,
          Material.END_ROD,
          Material.COCOA);

  /** Partially solid and standable, by the original's table. */
  private static final Set<Material> STANDABLE_PARTIAL =
      Set.of(
          Material.CHEST,
          Material.TRAPPED_CHEST,
          Material.ENDER_CHEST,
          Material.FARMLAND,
          Material.SNOW,
          Material.CACTUS,
          Material.SOUL_SAND,
          Material.REPEATER,
          Material.COMPARATOR,
          Material.LILY_PAD,
          Material.ENCHANTING_TABLE,
          Material.BREWING_STAND,
          Material.END_PORTAL_FRAME,
          Material.DRAGON_EGG,
          Material.HOPPER,
          Material.DAYLIGHT_DETECTOR,
          Material.CHORUS_PLANT,
          Material.DIRT_PATH);

  private Footings() {}

  static Footing of(Material type) {
    if (trap(type)) {
      return Footing.TRAP;
    }
    if (unstandable(type)) {
      return Footing.PARTIAL;
    }
    if (standablePartial(type)) {
      return Footing.STANDABLE;
    }
    return type.isCollidable() ? Footing.STANDABLE : Footing.CLEAR;
  }

  private static boolean trap(Material type) {
    return Tag.STONE_PRESSURE_PLATES.isTagged(type)
        || Tag.WOODEN_PRESSURE_PLATES.isTagged(type)
        || type == Material.HEAVY_WEIGHTED_PRESSURE_PLATE
        || type == Material.TRIPWIRE;
  }

  private static boolean unstandable(Material type) {
    var name = type.name();
    return UNSTANDABLE.contains(type)
        || Tag.DOORS.isTagged(type)
        || Tag.TRAPDOORS.isTagged(type)
        || Tag.FENCE_GATES.isTagged(type)
        || Tag.FLOWER_POTS.isTagged(type)
        || Tag.CANDLE_CAKES.isTagged(type)
        || name.endsWith("GLASS_PANE")
        || name.endsWith("_HEAD")
        || name.endsWith("_SKULL");
  }

  private static boolean standablePartial(Material type) {
    return STANDABLE_PARTIAL.contains(type)
        || Tag.BEDS.isTagged(type)
        || Tag.SLABS.isTagged(type)
        || Tag.STAIRS.isTagged(type)
        || Tag.FENCES.isTagged(type)
        || Tag.WALLS.isTagged(type)
        || Tag.ANVIL.isTagged(type)
        || Tag.CAULDRONS.isTagged(type)
        || Tag.WOOL_CARPETS.isTagged(type);
  }
}

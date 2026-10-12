// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/utils/UtilBlock.java, its full-solid and non-solid
// tables); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.EnumSet;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;

/**
 * Red Warfare's two block tables, as killstreaks used them: a full solid block, which a reward must
 * be called in on top of, and a block one walks through, which a landing reward settles through.
 * Minecraft 1.12's names are matched to today's; blocks added since follow the server's own
 * reckoning (a full solid block hides what is behind it). Water, lava, carpets, snow layers, vines
 * and every block with some solid part are neither, as they were.
 */
final class Ground {

  /** Full blocks of Red Warfare's table that the server does not count as hiding what is behind. */
  private static final Set<Material> SEE_THROUGH_SOLID =
      EnumSet.of(
          Material.GLASS,
          Material.ICE,
          Material.PACKED_ICE,
          Material.FROSTED_ICE,
          Material.SLIME_BLOCK,
          Material.BARRIER,
          Material.BEACON,
          Material.SPAWNER,
          Material.CHORUS_FLOWER,
          Material.PISTON,
          Material.STICKY_PISTON,
          Material.SEA_LANTERN,
          Material.GLOWSTONE,
          Material.REDSTONE_BLOCK,
          Material.TNT);

  /** Red Warfare's walk-through blocks that are not plants, rails, signs or the like below. */
  private static final Set<Material> WALK_THROUGH =
      EnumSet.of(
          Material.SHORT_GRASS,
          Material.FERN,
          Material.DEAD_BUSH,
          Material.TALL_GRASS,
          Material.LARGE_FERN,
          Material.SUNFLOWER,
          Material.LILAC,
          Material.ROSE_BUSH,
          Material.PEONY,
          Material.BROWN_MUSHROOM,
          Material.RED_MUSHROOM,
          Material.TORCH,
          Material.WALL_TORCH,
          Material.REDSTONE_TORCH,
          Material.REDSTONE_WALL_TORCH,
          Material.REDSTONE_WIRE,
          Material.WHEAT,
          Material.CARROTS,
          Material.POTATOES,
          Material.BEETROOTS,
          Material.LEVER,
          Material.SUGAR_CANE,
          Material.NETHER_PORTAL,
          Material.PUMPKIN_STEM,
          Material.MELON_STEM,
          Material.ATTACHED_PUMPKIN_STEM,
          Material.ATTACHED_MELON_STEM,
          Material.NETHER_WART,
          Material.END_PORTAL,
          Material.END_GATEWAY,
          Material.TRIPWIRE_HOOK,
          Material.TRIPWIRE,
          Material.STRUCTURE_VOID);

  private Ground() {}

  /** Whether {@code block} is a whole solid block, to stand a reward on. */
  static boolean fullSolid(Block block) {
    var type = block.getType();
    return type.isSolid()
        && (type.isOccluding()
            || SEE_THROUGH_SOLID.contains(type)
            || Tag.LEAVES.isTagged(type)
            || Tag.IMPERMEABLE.isTagged(type));
  }

  /** Whether {@code block} is one to walk through. */
  static boolean nonSolid(Block block) {
    var type = block.getType();
    return type.isAir()
        || WALK_THROUGH.contains(type)
        || Tag.FIRE.isTagged(type)
        || Tag.SAPLINGS.isTagged(type)
        || Tag.SMALL_FLOWERS.isTagged(type)
        || Tag.RAILS.isTagged(type)
        || Tag.ALL_SIGNS.isTagged(type)
        || Tag.PRESSURE_PLATES.isTagged(type)
        || Tag.BUTTONS.isTagged(type)
        || Tag.BANNERS.isTagged(type);
  }
}

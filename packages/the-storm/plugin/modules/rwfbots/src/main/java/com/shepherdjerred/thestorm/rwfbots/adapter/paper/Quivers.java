package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Quiver;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.AbstractArrow;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.CrossbowMeta;

/**
 * What a body's ranged weapon has left to shoot, and the arrows lying about that it could pick up.
 * A crossbow or a bow without Infinity spends the arrows in the inventory, so its quiver counts
 * them, plus one already loaded in a crossbow; an Infinity bow, a trident or no ranged weapon is
 * endless. A loose arrow is one stuck in a block that anyone may pick up (vanilla's ALLOWED pickup,
 * which a survival player's own bow or crossbow shot carries; Infinity and multishot copies do
 * not), within {@link #RADIUS} of a body whose quiver is running low. Main thread only.
 */
final class Quivers {

  /** Loose arrows further than this from every low body are not captured, in blocks. */
  static final double RADIUS = 16;

  /** At most this many loose arrows are captured, nearest to a low body first. */
  static final int MAX_LOOSE = 32;

  private static final Set<Material> ARROWS =
      Set.of(Material.ARROW, Material.TIPPED_ARROW, Material.SPECTRAL_ARROW);

  private Quivers() {}

  /** The arrows {@code body}'s ranged weapon has left, when it spends them. */
  static Quiver of(Player body) {
    var finite = false;
    var arrows = 0;
    for (var item : body.getInventory()) {
      if (item == null || item.isEmpty()) {
        continue;
      }
      finite |= spendsArrows(item);
      if (ARROWS.contains(item.getType())) {
        arrows += item.getAmount();
      } else if (item.getItemMeta() instanceof CrossbowMeta crossbow
          && crossbow.hasChargedProjectiles()) {
        arrows++;
      }
    }
    return finite ? Quiver.of(arrows) : Quiver.ENDLESS;
  }

  private static boolean spendsArrows(ItemStack item) {
    return item.getType() == Material.CROSSBOW
        || (item.getType() == Material.BOW && item.getEnchantmentLevel(Enchantment.INFINITY) == 0);
  }

  /** Arrows lying stuck in a block near any of {@code low}, anyone may pick up. */
  static List<Vec3> loose(List<Player> low) {
    if (low.isEmpty()) {
      return List.of();
    }
    var seekers = low.stream().map(body -> SnapshotCapture.vec(Places.at(body))).toList();
    return low.getFirst().getWorld().getEntitiesByClass(Arrow.class).stream()
        .filter(arrow -> arrow.getPickupStatus() == AbstractArrow.PickupStatus.ALLOWED)
        .filter(Arrow::isInBlock)
        .map(arrow -> SnapshotCapture.vec(Places.at(arrow)))
        .filter(pos -> nearest(pos, seekers) <= RADIUS)
        .sorted(
            Comparator.<Vec3>comparingDouble(pos -> nearest(pos, seekers))
                .thenComparingDouble(Vec3::x)
                .thenComparingDouble(Vec3::y)
                .thenComparingDouble(Vec3::z))
        .limit(MAX_LOOSE)
        .toList();
  }

  private static double nearest(Vec3 pos, List<Vec3> seekers) {
    return seekers.stream().mapToDouble(pos::distance).min().orElse(Double.POSITIVE_INFINITY);
  }
}

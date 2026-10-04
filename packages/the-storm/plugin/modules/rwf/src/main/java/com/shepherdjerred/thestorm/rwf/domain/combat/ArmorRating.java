// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/damage/CustomDamageEvent.java and
// redwarfare-core/src/me/libraryaddict/core/utils/UtilEnt.java, getArmorRating); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import java.util.List;

/**
 * Armor as Red Warfare counted it: the sum of each piece's 1.12 defence points, and Protection
 * enchantments as {@code (6 + level²) / 3} scaled by the kind of damage, capped at 20.
 */
public final class ArmorRating {

  /** Protection totals above this count as this. */
  public static final float PROTECTION_CAP = 20;

  private static final Tier LEATHER = new Tier(1, 3, 2, 1);
  private static final Tier GOLD = new Tier(2, 5, 3, 1);
  private static final Tier CHAINMAIL = new Tier(2, 5, 4, 1);
  private static final Tier IRON = new Tier(2, 6, 5, 2);
  private static final Tier DIAMOND = new Tier(3, 8, 6, 3);

  private ArmorRating() {}

  /** Defence points of one piece, by material; 0 for anything that is not armor. */
  public static int defence(String material) {
    var split = material.indexOf('_');
    if (split < 0) {
      return 0;
    }
    var tier =
        switch (material.substring(0, split)) {
          case "LEATHER" -> LEATHER;
          case "GOLDEN", "GOLD" -> GOLD;
          case "CHAINMAIL" -> CHAINMAIL;
          case "IRON" -> IRON;
          case "DIAMOND" -> DIAMOND;
          default -> null;
        };
    return tier == null ? 0 : tier.pick(material.substring(split + 1));
  }

  /** The total defence of {@code armor}. */
  public static int rating(List<ItemSpec> armor) {
    return armor.stream().mapToInt(piece -> defence(piece.material())).sum();
  }

  /** The Protection total against {@code attack}, capped at {@link #PROTECTION_CAP}. */
  public static float protection(List<ItemSpec> armor, AttackType attack) {
    float total = 0;
    for (var piece : armor) {
      for (var enchant : piece.enchantments().entrySet()) {
        total += protectionOf(enchant.getKey(), enchant.getValue(), attack);
      }
    }
    return Math.min(total, PROTECTION_CAP);
  }

  private static float protectionOf(String enchantment, int level, AttackType attack) {
    var base = (6 + level * level) / 3F;
    return switch (enchantment) {
      case "protection" -> attack.has(AttackType.Flag.IGNORE_ARMOR) ? 0 : base * 0.75F;
      case "fire_protection" -> attack.has(AttackType.Flag.BURN) ? base * 1.25F : 0;
      case "blast_protection" -> attack.has(AttackType.Flag.EXPLOSION) ? base * 1.5F : 0;
      case "projectile_protection" -> attack.has(AttackType.Flag.PROJECTILE) ? base * 1.5F : 0;
      case "feather_falling" -> attack.has(AttackType.Flag.FALL) ? base * 2.5F : 0;
      default -> 0;
    };
  }

  /** One armor tier's defence points per piece. */
  private record Tier(int helmet, int chestplate, int leggings, int boots) {

    int pick(String piece) {
      return switch (piece) {
        case "HELMET" -> helmet;
        case "CHESTPLATE" -> chestplate;
        case "LEGGINGS" -> leggings;
        case "BOOTS" -> boots;
        default -> 0;
      };
    }
  }
}

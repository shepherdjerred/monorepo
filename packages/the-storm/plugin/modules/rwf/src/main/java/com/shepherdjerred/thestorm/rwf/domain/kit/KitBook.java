// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/kits/
// KitTrooper.java, KitLongbow.java, KitShortbow.java, KitRewind.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.List;
import java.util.Optional;

/**
 * The kits a match offers. Milestone 1 ports the four free kits; the other eighteen and the
 * killstreaks are catalogued in the module's {@code KITS.md} for milestone 2.
 */
public final class KitBook {

  public static final KitSpec TROOPER =
      new KitSpec(
          "trooper",
          "Trooper",
          "The kit that sets the standards for all others. It receives a set of iron armor and an"
              + " iron sword, along with golden apples with which it can quickly recover from"
              + " fights.",
          0,
          KitAvailability.FREE,
          Optional.empty(),
          List.of(
              ItemSpec.of("IRON_SWORD").enchanted("sharpness", 1), ItemSpec.of("GOLDEN_APPLE", 3)),
          fullSet("IRON"),
          Optional.empty());

  public static final KitSpec LONGBOW =
      new KitSpec(
          "longbow",
          "Longbow",
          "A supporting archer, this kit receives a bow that will send enemies flying.",
          0,
          KitAvailability.FREE,
          Optional.empty(),
          List.of(
              ItemSpec.of("STONE_SWORD"),
              ItemSpec.of("BOW").enchanted("infinity", 1).enchanted("punch", 3),
              ItemSpec.of("ARROW")),
          archerArmor(),
          Optional.empty());

  public static final KitSpec SHORTBOW =
      new KitSpec(
          "shortbow",
          "Shortbow",
          "A powerful archer, this kit receives a bow with which it deals precise damage.",
          0,
          KitAvailability.FREE,
          Optional.empty(),
          List.of(
              ItemSpec.of("WOODEN_SWORD").enchanted("knockback", 1),
              ItemSpec.of("BOW").enchanted("infinity", 1).enchanted("power", 2),
              ItemSpec.of("ARROW")),
          archerArmor(),
          Optional.empty());

  public static final KitSpec REWIND =
      new KitSpec(
          "rewind",
          "Rewind",
          "This kit is a master of hitting and running, as it has a magical clock that will"
              + " teleport it where it was 30 seconds in the past. While health is unchanged, if"
              + " the user was on fire, it will be put out like it never existed.",
          0,
          KitAvailability.FREE,
          Optional.empty(),
          List.of(ItemSpec.of("IRON_SWORD"), ItemSpec.of("CLOCK").named("Time Machine")),
          List.of(
              ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS),
              ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS),
              ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE).enchanted("protection", 1),
              ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
          Optional.of(Rewinder.ABILITY));

  /** The milestone-1 kits, in Red Warfare's menu order. */
  public static final List<KitSpec> MILESTONE_ONE = List.of(TROOPER, LONGBOW, SHORTBOW, REWIND);

  private KitBook() {}

  public static Optional<KitSpec> byId(String id) {
    return MILESTONE_ONE.stream().filter(kit -> kit.id().equals(id)).findFirst();
  }

  private static List<ItemSpec> fullSet(String tier) {
    return List.of(
        ItemSpec.armor(tier + "_BOOTS", ArmorSlot.BOOTS),
        ItemSpec.armor(tier + "_LEGGINGS", ArmorSlot.LEGGINGS),
        ItemSpec.armor(tier + "_CHESTPLATE", ArmorSlot.CHESTPLATE),
        ItemSpec.armor(tier + "_HELMET", ArmorSlot.HELMET));
  }

  /** Chain boots and helmet with iron leggings and chestplate, as both archers wore. */
  private static List<ItemSpec> archerArmor() {
    return List.of(
        ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
        ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS),
        ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE),
        ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET));
  }
}

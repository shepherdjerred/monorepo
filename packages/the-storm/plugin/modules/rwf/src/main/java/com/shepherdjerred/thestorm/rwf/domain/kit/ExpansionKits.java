package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.List;
import java.util.Optional;

/**
 * Eighteen additional kits, six in each play category; all participate in the existing rotation.
 */
public final class ExpansionKits {
  private ExpansionKits() {}

  public static final KitSpec DUELIST =
      kit(
          new Offer(
              "duelist",
              "Duelist",
              "Iron sword and chainmail; isolated melee hits add 1.5 damage before armour when nobody else stands within 6 blocks of the victim.",
              250,
              KitCategory.CLASSIC),
          new Gear(
              List.of(ItemSpec.of("IRON_SWORD")),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("duelist")),
          new KitSpec.Menu(
              "IRON_SWORD",
              List.of(
                  "Isolated melee hits add 1.5 damage",
                  "No third combatant within 6 blocks",
                  "Iron sword, full chainmail")));

  public static final KitSpec KNIGHT =
      kit(
          new Offer(
              "knight",
              "Knight",
              "Raise your shield just before a hit: blocking within 0.4 seconds primes a counterstrike adding 2 damage for 3 seconds, once every 12 seconds.",
              300,
              KitCategory.CLASSIC),
          new Gear(
              List.of(ItemSpec.of("IRON_SWORD"), ItemSpec.of("SHIELD")),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("knight")),
          new KitSpec.Menu(
              "SHIELD",
              List.of(
                  "Timely shield block primes a counter",
                  "Next melee hit adds 2 damage",
                  "3-second counter, 12-second recharge")));

  public static final KitSpec RAVAGER =
      kit(
          new Offer(
              "ravager",
              "Ravager",
              "An axe fighter with two golden apples; striking a raised enemy shield disables it for 3 seconds, once every 12 seconds.",
              200,
              KitCategory.CLASSIC),
          new Gear(
              List.of(ItemSpec.of("IRON_AXE"), ItemSpec.of("GOLDEN_APPLE", 2)),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("ravager")),
          new KitSpec.Menu(
              "IRON_AXE",
              List.of(
                  "Axe disables raised shields for 3s",
                  "12-second shield-break recharge",
                  "Chainmail, 2 golden apples")));

  public static final KitSpec ACROBAT =
      kit(
          new Offer(
              "acrobat",
              "Acrobat",
              "Right-click your feather while airborne to jump again. One extra jump per landing and an 8-second recharge; light armour and Feather Falling II.",
              250,
              KitCategory.CLASSIC),
          new Gear(
              List.of(ItemSpec.of("STONE_SWORD"), ItemSpec.of("FEATHER")),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS).enchanted("feather_falling", 2),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("acrobat")),
          new KitSpec.Menu(
              "FEATHER",
              List.of(
                  "Feather triggers an airborne jump",
                  "One extra jump, 8-second recharge",
                  "Light armour, Feather Falling II")));

  public static final KitSpec ALCHEMIST =
      kit(
          new Offer(
              "alchemist",
              "Alchemist",
              "Three finite flasks weaken and slow enemies within 3 blocks for 5 seconds; allies are safe. Wait 10 seconds between throws.",
              300,
              KitCategory.CLASSIC),
          new Gear(
              List.of(
                  ItemSpec.of("STONE_SWORD"),
                  ItemSpec.of("SPLASH_POTION", 3)
                      .named("Debilitating Flask")
                      .potion("weakness", 0, 100)
                      .potion("slowness", 0, 100)),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("alchemist")),
          new KitSpec.Menu(
              "SPLASH_POTION",
              List.of(
                  "3 flasks: Weakness I and Slowness I",
                  "Enemies within 3 blocks, lasts 5s",
                  "10 seconds between throws")));

  public static final KitSpec SCAVENGER =
      kit(
          new Offer(
              "scavenger",
              "Scavenger",
              "Your first three credited kills leave salvage for you alone. Collect it within 10 seconds to heal 4 health and receive 8 arrows.",
              200,
              KitCategory.CLASSIC),
          new Gear(
              List.of(ItemSpec.of("IRON_SWORD")),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("scavenger")),
          new KitSpec.Menu(
              "RAW_IRON",
              List.of(
                  "First 3 kills leave private salvage",
                  "Collect within 10s: heal 4, 8 arrows",
                  "Iron sword and full chainmail")));

  public static final KitSpec ARBALIST =
      kit(
          new Offer(
              "arbalist",
              "Arbalist",
              "A precise crossbow with Quick Charge II and Piercing II, 48 finite arrows, a stone sword and archer armour.",
              250,
              KitCategory.RANGED),
          new Gear(
              List.of(
                  ItemSpec.of("STONE_SWORD"),
                  ItemSpec.of("CROSSBOW").enchanted("quick_charge", 2).enchanted("piercing", 2),
                  ItemSpec.of("ARROW", 48)),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.empty()),
          new KitSpec.Menu(
              "CROSSBOW",
              List.of(
                  "Quick Charge II, Piercing II crossbow",
                  "48 finite arrows, stone sword",
                  "Iron and chainmail archer armour")));

  public static final KitSpec VOLLEY =
      kit(
          new Offer(
              "volley",
              "Volley",
              "A spread crossbow with Multishot I and Quick Charge I, 36 finite arrows, a wooden sword and light armour.",
              250,
              KitCategory.RANGED),
          new Gear(
              List.of(
                  ItemSpec.of("WOODEN_SWORD"),
                  ItemSpec.of("CROSSBOW").enchanted("multishot", 1).enchanted("quick_charge", 1),
                  ItemSpec.of("ARROW", 36)),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.empty()),
          new KitSpec.Menu(
              "CROSSBOW",
              List.of(
                  "Multishot I, Quick Charge I crossbow",
                  "36 finite arrows, wooden sword",
                  "Light armour")));

  public static final KitSpec MARKSMAN =
      kit(
          new Offer(
              "marksman",
              "Marksman",
              "An Infinity and Power I bow rewards fully drawn shots travelling at least 24 blocks with 2 extra raw damage, once every 8 seconds.",
              350,
              KitCategory.RANGED),
          new Gear(
              List.of(
                  ItemSpec.of("WOODEN_SWORD"),
                  ItemSpec.of("BOW").enchanted("power", 1).enchanted("infinity", 1),
                  ItemSpec.of("SPYGLASS"),
                  ItemSpec.of("ARROW")),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("marksman")),
          new KitSpec.Menu(
              "SPYGLASS",
              List.of(
                  "Power I and Infinity bow, spyglass",
                  "Full draw at 24+ blocks: +2 damage",
                  "8-second long-shot recharge")));

  public static final KitSpec WINDRUNNER =
      kit(
          new Offer(
              "windrunner",
              "Windrunner",
              "A copper spear and Infinity bow with four finite wind charges for positioning; light armour keeps the loadout mobile.",
              300,
              KitCategory.RANGED),
          new Gear(
              List.of(
                  ItemSpec.of("COPPER_SPEAR"),
                  ItemSpec.of("BOW").enchanted("infinity", 1),
                  ItemSpec.of("WIND_CHARGE", 4),
                  ItemSpec.of("ARROW")),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.empty()),
          new KitSpec.Menu(
              "WIND_CHARGE",
              List.of("Copper spear and Infinity bow", "4 native wind charges", "Light armour")));

  public static final KitSpec HARPOONER =
      kit(
          new Offer(
              "harpooner",
              "Harpooner",
              "Throw a Loyalty III trident and wait for its return. A stone sword and archer armour cover the recovery; no Riptide or Channeling.",
              300,
              KitCategory.RANGED),
          new Gear(
              List.of(ItemSpec.of("STONE_SWORD"), ItemSpec.of("TRIDENT").enchanted("loyalty", 3)),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.empty()),
          new KitSpec.Menu(
              "TRIDENT",
              List.of(
                  "Loyalty III returning trident",
                  "Stone sword while it returns",
                  "Iron and chainmail archer armour")));

  public static final KitSpec FLETCHER =
      kit(
          new Offer(
              "fletcher",
              "Fletcher",
              "A Power I bow with 24 ordinary arrows and eight finite arrows that slow enemies for 3 seconds. Select the tipped stack in your offhand to prioritise it.",
              300,
              KitCategory.RANGED),
          new Gear(
              List.of(
                  ItemSpec.of("STONE_SWORD"),
                  ItemSpec.of("BOW").enchanted("power", 1),
                  ItemSpec.of("TIPPED_ARROW", 8).named("Slowing Arrow").potion("slowness", 0, 60),
                  ItemSpec.of("ARROW", 24)),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.empty()),
          new KitSpec.Menu(
              "TIPPED_ARROW",
              List.of(
                  "Power I bow, 24 ordinary arrows",
                  "8 arrows: Slowness I for 3 seconds",
                  "Offhand ammunition takes priority")));

  public static final KitSpec LANCER =
      kit(
          new Offer(
              "lancer",
              "Lancer",
              "An iron spear and shield with chainmail. Use native spear reach, timed jabs and kinetic charge attacks to control a lane.",
              300,
              KitCategory.TACTICAL),
          new Gear(
              List.of(ItemSpec.of("IRON_SPEAR"), ItemSpec.of("SHIELD")),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.empty()),
          new KitSpec.Menu(
              "IRON_SPEAR",
              List.of(
                  "Native iron spear jabs and charges",
                  "Shield and full chainmail",
                  "Keep enemies at spear range")));

  public static final KitSpec MACEGUARD =
      kit(
          new Offer(
              "maceguard",
              "Maceguard",
              "A native mace with three finite wind charges and light armour with Feather Falling II. Smash damage and landing reset follow the native weapon rules.",
              400,
              KitCategory.TACTICAL),
          new Gear(
              List.of(ItemSpec.of("MACE"), ItemSpec.of("WIND_CHARGE", 3)),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS).enchanted("feather_falling", 2),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.empty()),
          new KitSpec.Menu(
              "MACE",
              List.of(
                  "Native mace smash and fall reset",
                  "3 wind charges for positioning",
                  "Light armour, Feather Falling II")));

  public static final KitSpec QUARTERMASTER =
      kit(
          new Offer(
              "quartermaster",
              "Quartermaster",
              "Three supply bundles give living allies within 6 blocks 8 arrows and Absorption I for 4 seconds. Excludes yourself; 20-second recharge.",
              250,
              KitCategory.TACTICAL),
          new Gear(
              List.of(ItemSpec.of("STONE_SWORD"), ItemSpec.of("BUNDLE", 3)),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("quartermaster")),
          new KitSpec.Menu(
              "BUNDLE",
              List.of(
                  "3 bundles supply allies within 6",
                  "8 arrows and Absorption I for 4s",
                  "Excludes self, 20-second recharge")));

  public static final KitSpec WARDEN =
      kit(
          new Offer(
              "warden",
              "Warden",
              "Deploy a listening post for 30 seconds. It reports approximate directions of nearby enemy sounds within 12 blocks, at most once every 3 seconds; 35-second recharge.",
              350,
              KitCategory.TACTICAL),
          new Gear(
              List.of(ItemSpec.of("IRON_SWORD"), ItemSpec.of("CALIBRATED_SCULK_SENSOR")),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("warden")),
          new KitSpec.Menu(
              "CALIBRATED_SCULK_SENSOR",
              List.of(
                  "Listening post lasts 30 seconds",
                  "Hears sounds within 12, reports /3s",
                  "35-second deployment recharge")));

  public static final KitSpec SMOKESCREEN =
      kit(
          new Offer(
              "smokescreen",
              "Smokescreen",
              "Create a smoke field of radius 4 for 6 seconds, blocking human and bot vision while sounds and projectiles still pass. Recharges in 30 seconds.",
              400,
              KitCategory.TACTICAL),
          new Gear(
              List.of(ItemSpec.of("STONE_SWORD"), ItemSpec.of("GRAY_DYE")),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("smokescreen")),
          new KitSpec.Menu(
              "GRAY_DYE",
              List.of(
                  "Radius 4 smoke blocks vision for 6s",
                  "Sound and projectiles pass through",
                  "30-second smoke recharge")));

  public static final KitSpec TACTICIAN =
      kit(
          new Offer(
              "tactician",
              "Tactician",
              "Hold still for a 1.2-second horn windup to grant nearby allies within 8 blocks Speed I and Resistance I for 6 seconds. Excludes self, never stacks; 40-second recharge.",
              300,
              KitCategory.TACTICAL),
          new Gear(
              List.of(ItemSpec.of("IRON_SWORD"), ItemSpec.of("GOAT_HORN")),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("tactician")),
          new KitSpec.Menu(
              "GOAT_HORN",
              List.of(
                  "Stand still 1.2s to sound the horn",
                  "Allies within 8: speed and resistance",
                  "6-second buff, 40-second recharge")));

  public static final List<KitSpec> ALL =
      List.of(
          DUELIST,
          KNIGHT,
          RAVAGER,
          ACROBAT,
          ALCHEMIST,
          SCAVENGER,
          ARBALIST,
          VOLLEY,
          MARKSMAN,
          WINDRUNNER,
          HARPOONER,
          FLETCHER,
          LANCER,
          MACEGUARD,
          QUARTERMASTER,
          WARDEN,
          SMOKESCREEN,
          TACTICIAN);

  private record Offer(
      String id, String name, String description, int price, KitCategory category) {}

  private record Gear(List<ItemSpec> hotbar, List<ItemSpec> armor, Optional<String> ability) {}

  private static KitSpec kit(Offer offer, Gear gear, KitSpec.Menu menu) {
    var tier =
        offer.price() <= 200
            ? KitTier.BASIC
            : offer.price() <= 350 ? KitTier.MID : KitTier.ADVANCED;
    return new KitSpec(
        offer.id(),
        offer.name(),
        offer.description(),
        offer.price(),
        tier,
        offer.category(),
        KitAvailability.PURCHASE,
        Optional.empty(),
        gear.hotbar(),
        gear.armor(),
        gear.ability(),
        menu);
  }
}

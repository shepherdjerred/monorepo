package com.shepherdjerred.thestorm.shops.adapter.content;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Reviewed historical signs and their explicitly identified containers. */
public final class HistoricalShopCatalog {
  private HistoricalShopCatalog() {}

  public record Point(int x, int y, int z) {}

  public static final UUID STAFF_CUSTODY = new UUID(0, 0);

  /** Exact legacy text and an optional original inventory template, before normalization. */
  public record Details(
      List<String> originalLines, int sourceSlot, boolean buysFromPlayer, boolean rewrite) {
    public static final Details LEGACY = new Details(List.of(), -1, false, false);

    public Details {
      originalLines = List.copyOf(originalLines);
      if ((!originalLines.isEmpty() && originalLines.size() != 4)
          || sourceSlot < -1
          || sourceSlot > 26
          || (sourceSlot >= 0 && originalLines.isEmpty()))
        throw new IllegalArgumentException("invalid recorded shop details");
    }
  }

  public record Additional(List<Entry> entries) {
    public Additional {
      entries = List.copyOf(entries);
    }
  }

  public record Entry(
      String id,
      String world,
      Point sign,
      Point container,
      UUID owner,
      String ownerName,
      String item,
      int quantity,
      long price,
      int stockTarget,
      String historicalItemName,
      SignFormat signFormat,
      Details details) {
    public Entry {
      if (id.isBlank()
          || world.isBlank()
          || ownerName.isBlank()
          || historicalItemName.isBlank()
          || !item.matches("[a-z0-9_]+")
          || quantity < 1
          || price < 1
          || stockTarget < quantity) {
        throw new IllegalArgumentException("invalid historical shop: " + id);
      }
    }

    public List<String> expectedLines() {
      if (!details.originalLines().isEmpty()) return details.originalLines();
      if (signFormat.name().startsWith("BOW_")) return bowLines();
      if (signFormat.name().contains("POTION")) return potionLines();
      if (signFormat.name().startsWith("QUANTITY_WITH_")) return quantityLines();
      return switch (signFormat) {
        case QUANTITY_ITEM, UNBREAKING_PICK ->
            List.of("[Buy]", Integer.toString(quantity), historicalItemName, Long.toString(price));
        case ITEM_FOR_PRICE -> List.of("[Buy]", historicalItemName, "for", Long.toString(price));
        case QUANTITY_ITEM_FOR_PRICE ->
            List.of("[Buy]", quantity + " " + historicalItemName, "for", Long.toString(price));
        case QUANTITY_ITEM_DOLLAR ->
            List.of("[Buy]", quantity + " " + historicalItemName, "", "$" + price);
        case ITEM_DOLLAR -> List.of("[Buy]", historicalItemName, "", "$" + price);
        case ITEM_DISK -> List.of("[Buy]", historicalItemName, "Disk", Long.toString(price));
        case ITEM_BANNER -> List.of("[Buy]", historicalItemName, "Banner", Long.toString(price));
        case ONE_NOTE_BLOCK -> List.of("[Buy]", "One Note", "Block", Long.toString(price));
        case TWO_STACKS_CREDITS ->
            List.of("[Buy]", historicalItemName, "2 Stacks for", price + "cr");
        case DEAL_OF_WEEK ->
            List.of(
                "[Buy]",
                "Deal of the week",
                quantity + " " + historicalItemName + " for",
                Long.toString(price));
        default -> throw new IllegalStateException("unknown historical sign: " + signFormat);
      };
    }

    private List<String> potionLines() {
      return switch (signFormat) {
        case HASTE_POTION -> List.of("[Buy]", "Potion Of", "Haste", Long.toString(price));
        case HASTE_POTION_EXT ->
            List.of("[Buy]", Integer.toString(quantity), historicalItemName, Long.toString(price));
        case FIRE_RESISTANCE_POTION ->
            List.of("[Buy]", "Potion of Fire", "Resistance", Long.toString(price));
        case WATER_BREATHING_POTION ->
            List.of("[Buy]", "Potion of Water", "Breathing", Long.toString(price));
        case NIGHT_VISION_POTION ->
            List.of("[Buy]", "Potion of Night", "Vision", Long.toString(price));
        case INVISIBILITY_POTION ->
            List.of("[Buy]", "Potion of", "Invisibility", Long.toString(price));
        case LEAPING_POTION -> List.of("[Buy]", "Potion of", "Leaping", Long.toString(price));
        case SWIFTNESS_POTION -> List.of("[Buy]", "Potion of", "Swiftness I", Long.toString(price));
        case STRONG_SWIFTNESS_POTION ->
            List.of("[Buy]", "Potion of", "Swiftness II", Long.toString(price));
        default -> throw new IllegalStateException("not a potion sign: " + signFormat);
      };
    }

    private List<String> quantityLines() {
      return switch (signFormat) {
        case QUANTITY_WITH_ITEM ->
            List.of("[Buy]", quantity + " " + historicalItemName, "", Long.toString(price));
        case QUANTITY_WITH_BRICKS ->
            List.of("[Buy]", quantity + " " + historicalItemName, "Bricks", Long.toString(price));
        case QUANTITY_WITH_EYES ->
            List.of("[Buy]", quantity + " " + historicalItemName, "Eyes", Long.toString(price));
        case QUANTITY_WITH_HEAD ->
            List.of("[Buy]", quantity + " " + historicalItemName, "Head", Long.toString(price));
        case QUANTITY_WITH_POTATOES ->
            List.of("[Buy]", quantity + " " + historicalItemName, "Potatoes", Long.toString(price));
        case QUANTITY_WITH_ARMOR ->
            List.of("[Buy]", quantity + " " + historicalItemName, "Armor", Long.toString(price));
        case QUANTITY_WITH_ARMOR_FOR ->
            List.of(
                "[Buy]", quantity + " " + historicalItemName, "Armor for", Long.toString(price));
        default -> throw new IllegalStateException("not a quantity sign: " + signFormat);
      };
    }

    private List<String> bowLines() {
      return switch (signFormat) {
        case BOW_POWER_IV, BOW_FLAME_I ->
            List.of("[Buy]", historicalItemName, "Good for anvils", "$" + price);
        case BOW_USED_POWER_III -> List.of("[Buy]", "Used Power III", "73 uses left", "$" + price);
        case BOW_UNBREAKING_FLAME_PUNCH ->
            List.of("[Buy]", "Unb III Flame I", "Punch I Bow", "$" + price);
        case BOW_UNBREAKING_POWER_PUNCH ->
            List.of("[Buy]", "Unb III Power III", "Punch I Bow", "$" + price);
        case BOW_UNBREAKING_FLAME_POWER ->
            List.of("[Buy]", "Unb III Flame I", "Power IV Bow", "$" + price);
        default -> throw new IllegalStateException("not a historical bow sign: " + signFormat);
      };
    }
  }

  public enum SignFormat {
    QUANTITY_ITEM,
    EFFICIENCY_I,
    EFFICIENCY_II,
    EFFICIENCY_III,
    SILK_TOUCH,
    SPLASH_WEAKNESS,
    SPLASH_POISON,
    SPLASH_STRONG_POISON,
    SPLASH_STRONG_HARMING,
    UNBREAKING_PICK,
    ITEM_FOR_PRICE,
    QUANTITY_ITEM_FOR_PRICE,
    QUANTITY_ITEM_DOLLAR,
    ITEM_DOLLAR,
    ITEM_DISK,
    ITEM_BANNER,
    ONE_NOTE_BLOCK,
    TWO_STACKS_CREDITS,
    BOW_POWER_IV,
    BOW_FLAME_I,
    BOW_USED_POWER_III,
    BOW_UNBREAKING_FLAME_PUNCH,
    BOW_UNBREAKING_POWER_PUNCH,
    BOW_UNBREAKING_FLAME_POWER,
    BOW_WITH_ARROWS,
    HASTE_POTION,
    HASTE_POTION_EXT,
    FIRE_RESISTANCE_POTION,
    WATER_BREATHING_POTION,
    NIGHT_VISION_POTION,
    INVISIBILITY_POTION,
    LEAPING_POTION,
    SWIFTNESS_POTION,
    STRONG_SWIFTNESS_POTION,
    QUANTITY_WITH_ITEM,
    QUANTITY_WITH_BRICKS,
    QUANTITY_WITH_EYES,
    QUANTITY_WITH_HEAD,
    QUANTITY_WITH_POTATOES,
    QUANTITY_WITH_ARMOR,
    QUANTITY_WITH_ARMOR_FOR,
    DEAL_OF_WEEK
  }

  /** Reads the fixed, audited catalog. Unknown and potentially valuable items use the small cap. */
  public static List<Entry> load() {
    var stream =
        Objects.requireNonNull(
            HistoricalShopCatalog.class.getResourceAsStream("/historical-shops.csv"));
    try (var reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
      var entries = new ArrayList<>(read(reader));
      entries.addAll(additional());
      return validate(entries);
    } catch (IOException error) {
      throw new UncheckedIOException("cannot read historical shops", error);
    }
  }

  static List<Entry> read(BufferedReader reader) throws IOException {
    var result = new ArrayList<Entry>();
    String line;
    while ((line = reader.readLine()) != null) {
      if (line.startsWith("#") || line.isBlank()) continue;
      result.add(parseEntry(line));
    }
    return validate(result);
  }

  private static List<Entry> validate(List<Entry> entries) {
    var ids = new HashSet<String>();
    var signs = new HashSet<String>();
    var budgets = new java.util.HashMap<String, Integer>();
    var allocations = new java.util.HashMap<String, Integer>();
    for (var entry : entries) {
      if (!ids.add(entry.id()) || !signs.add(entry.world() + ":" + entry.sign())) {
        throw new IllegalArgumentException("duplicate historical shop: " + entry.id());
      }
      checkStockBudget(entry, budgets, allocations);
    }
    return List.copyOf(entries);
  }

  private static List<Entry> additional() throws IOException {
    try (var stream =
        Objects.requireNonNull(
            HistoricalShopCatalog.class.getResourceAsStream("/historical-shop-restorations.yml"))) {
      var parsed =
          com.shepherdjerred.thestorm.core.config.StrictYaml.parse(
              "historical-shop-restorations.yml",
              new String(stream.readAllBytes(), StandardCharsets.UTF_8),
              Additional.class);
      return switch (parsed) {
        case com.shepherdjerred.thestorm.core.result.Result.Ok(var value) -> value.entries();
        case com.shepherdjerred.thestorm.core.result.Result.Err(var problems) ->
            throw new IllegalStateException("Invalid historical shop restorations: " + problems);
      };
    }
  }

  private static Entry parseEntry(String line) {
    var f = line.split(",", -1);
    if (f.length != 15 && f.length != 16)
      throw new IllegalArgumentException("invalid historical shop row");
    return new Entry(
        f[0],
        f[1],
        point(f, 2),
        point(f, 5),
        UUID.fromString(f[8]),
        f[9],
        f[10],
        Integer.parseInt(f[11]),
        Long.parseLong(f[12]),
        Integer.parseInt(f[13]),
        f[14],
        f.length == 16 ? SignFormat.valueOf(f[15]) : SignFormat.QUANTITY_ITEM,
        Details.LEGACY);
  }

  private static void checkStockBudget(
      Entry entry,
      java.util.Map<String, Integer> budgets,
      java.util.Map<String, Integer> allocations) {
    if (bulk(entry.item())) {
      if (entry.stockTarget() > 1728)
        throw new IllegalArgumentException("bulk stock exceeds one chest");
      return;
    }
    var authority =
        entry.owner().equals(STAFF_CUSTODY)
            ? "staff:" + entry.world() + ":" + entry.container()
            : entry.owner().toString();
    var key = authority + ":" + entry.item();
    var goods =
        key
            + ":"
            + entry.world()
            + ":"
            + entry.container()
            + ":"
            + entry.details().sourceSlot()
            + ":"
            + entry.signFormat();
    var previous = allocations.getOrDefault(goods, 0);
    var target = Math.max(previous, entry.stockTarget());
    allocations.put(goods, target);
    var total = budgets.merge(key, target - previous, Math::addExact);
    if (entry.stockTarget() > 32 || total > 32)
      throw new IllegalArgumentException("valuable stock exceeds owner budget: " + entry.id());
  }

  private static Point point(String[] fields, int offset) {
    return new Point(
        Integer.parseInt(fields[offset]),
        Integer.parseInt(fields[offset + 1]),
        Integer.parseInt(fields[offset + 2]));
  }

  public static boolean bulk(String item) {
    return Set.of(
            "acacia_fence",
            "acacia_leaves",
            "acacia_planks",
            "apple",
            "birch_fence",
            "birch_leaves",
            "birch_planks",
            "black_wool",
            "book",
            "bread",
            "bricks",
            "cactus",
            "chiseled_red_sandstone",
            "chiseled_sandstone",
            "chiseled_stone_bricks",
            "clay_ball",
            "coarse_dirt",
            "cobblestone_slab",
            "cobblestone_wall",
            "cooked_mutton",
            "cooked_porkchop",
            "cookie",
            "cracked_stone_bricks",
            "crafting_table",
            "dark_oak_fence",
            "dark_oak_leaves",
            "dark_oak_planks",
            "end_stone",
            "feather",
            "furnace",
            "glass",
            "glass_pane",
            "ink_sac",
            "jungle_fence",
            "jungle_leaves",
            "leather",
            "magenta_wool",
            "melon",
            "melon_slice",
            "mossy_cobblestone",
            "mossy_cobblestone_wall",
            "mossy_stone_bricks",
            "nether_bricks",
            "nether_brick_fence",
            "nether_wart",
            "oak_fence",
            "pink_wool",
            "polished_andesite",
            "polished_diorite",
            "polished_granite",
            "poppy",
            "purple_wool",
            "red_sand",
            "red_sandstone",
            "sandstone",
            "smooth_red_sandstone",
            "smooth_sandstone",
            "smooth_stone",
            "smooth_stone_slab",
            "snow",
            "snow_block",
            "soul_sand",
            "spruce_fence",
            "spruce_planks",
            "stick",
            "sugar",
            "terracotta",
            "white_wool",
            "acacia_log",
            "arrow",
            "andesite",
            "birch_log",
            "baked_potato",
            "bone",
            "cobblestone",
            "coal",
            "cocoa_beans",
            "carrot",
            "cooked_beef",
            "cooked_chicken",
            "dark_oak_log",
            "diorite",
            "dirt",
            "grass_block",
            "gunpowder",
            "rotten_flesh",
            "sand",
            "string",
            "gravel",
            "granite",
            "hay_block",
            "wheat",
            "oak_log",
            "oak_leaves",
            "oak_planks",
            "jungle_log",
            "mutton",
            "netherrack",
            "packed_ice",
            "prismarine",
            "prismarine_bricks",
            "pumpkin",
            "potato",
            "pumpkin_seeds",
            "melon_seeds",
            "rail",
            "red_mushroom",
            "brown_mushroom",
            "spruce_log",
            "spruce_leaves",
            "stone",
            "stone_bricks",
            "sugar_cane",
            "wheat_seeds",
            "vine")
        .contains(item);
  }
}

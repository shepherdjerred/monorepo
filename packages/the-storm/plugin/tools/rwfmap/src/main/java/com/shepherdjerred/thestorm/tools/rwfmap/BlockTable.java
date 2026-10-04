package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

/**
 * The curated table that sorts a block state into a {@link BlockShape} and whether it blocks sight.
 * Rules are tried in order; the first that applies wins. A state no rule knows is a hard error so a
 * new block is classified on purpose, never by accident.
 *
 * <p>Approximations, chosen so bots err towards caution: a closed trapdoor is a slab of its half,
 * an open door or trapdoor is passable, snow of two or more layers is a full block, fence gates are
 * fences until opened, and carpets, pressure plates and the rest of the flat decorations are
 * passable.
 */
public final class BlockTable {

  /**
   * One classified state.
   *
   * @param shape the shape the baker sees
   * @param blocksSight whether the cell stops a line of sight
   */
  public record Classified(BlockShape shape, boolean blocksSight) {}

  private static final Classified FULL = new Classified(BlockShape.FULL, true);
  private static final Classified FULL_CLEAR = new Classified(BlockShape.FULL, false);
  private static final Classified SLAB_BOTTOM = new Classified(BlockShape.SLAB_BOTTOM, true);
  private static final Classified SLAB_TOP = new Classified(BlockShape.SLAB_TOP, true);
  private static final Classified STAIRS = new Classified(BlockShape.STAIRS, true);
  private static final Classified FENCE = new Classified(BlockShape.FENCE, false);
  private static final Classified PANE = new Classified(BlockShape.PANE, false);
  private static final Classified LIQUID = new Classified(BlockShape.LIQUID, false);
  private static final Classified LADDER = new Classified(BlockShape.LADDER, false);
  private static final Classified PASSABLE = new Classified(BlockShape.PASSABLE, false);

  private static final Set<String> PASSABLE_IDS =
      Set.of(
          "air",
          "cave_air",
          "void_air",
          "light",
          "structure_void",
          "torch",
          "wall_torch",
          "soul_torch",
          "soul_wall_torch",
          "redstone_torch",
          "redstone_wall_torch",
          "lever",
          "tripwire",
          "tripwire_hook",
          "redstone_wire",
          "repeater",
          "comparator",
          "rail",
          "powered_rail",
          "detector_rail",
          "activator_rail",
          "short_grass",
          "tall_grass",
          "fern",
          "large_fern",
          "dead_bush",
          "bush",
          "firefly_bush",
          "short_dry_grass",
          "tall_dry_grass",
          "seagrass",
          "tall_seagrass",
          "sugar_cane",
          "kelp",
          "kelp_plant",
          "nether_sprouts",
          "crimson_roots",
          "warped_roots",
          "hanging_roots",
          "glow_lichen",
          "sculk_vein",
          "moss_carpet",
          "pale_moss_carpet",
          "pink_petals",
          "wildflowers",
          "leaf_litter",
          "spore_blossom",
          "dandelion",
          "poppy",
          "blue_orchid",
          "allium",
          "azure_bluet",
          "red_tulip",
          "orange_tulip",
          "white_tulip",
          "pink_tulip",
          "oxeye_daisy",
          "cornflower",
          "lily_of_the_valley",
          "wither_rose",
          "torchflower",
          "open_eyeblossom",
          "closed_eyeblossom",
          "sunflower",
          "lilac",
          "rose_bush",
          "peony",
          "pitcher_plant",
          "brown_mushroom",
          "red_mushroom",
          "crimson_fungus",
          "warped_fungus",
          "cobweb",
          "cocoa",
          "wheat",
          "carrots",
          "potatoes",
          "beetroots",
          "nether_wart",
          "sweet_berry_bush",
          "lily_pad",
          "end_rod",
          "lightning_rod",
          "player_head",
          "player_wall_head");

  private static final List<String> PASSABLE_SUFFIXES =
      List.of(
          "_carpet",
          "_pressure_plate",
          "_button",
          "_sign",
          "_banner",
          "_sapling",
          "_propagule",
          "_coral",
          "_coral_fan",
          "_skull",
          "_head",
          "_candle",
          "_stem_plant");

  private static final Set<String> LADDER_IDS =
      Set.of(
          "ladder",
          "vine",
          "scaffolding",
          "weeping_vines",
          "weeping_vines_plant",
          "twisting_vines",
          "twisting_vines_plant",
          "cave_vines",
          "cave_vines_plant");

  private static final Set<String> LIQUID_IDS = Set.of("water", "lava", "bubble_column");

  private static final Set<String> PANE_IDS = Set.of("glass_pane", "iron_bars", "chain");

  private static final Set<String> CLEAR_FULL_IDS = Set.of("glass", "barrier");

  private static final Set<String> FULL_IDS =
      Set.of(
          "stone",
          "cobblestone",
          "mossy_cobblestone",
          "smooth_stone",
          "andesite",
          "polished_andesite",
          "diorite",
          "polished_diorite",
          "granite",
          "polished_granite",
          "deepslate",
          "cobbled_deepslate",
          "polished_deepslate",
          "chiseled_deepslate",
          "tuff",
          "polished_tuff",
          "chiseled_tuff",
          "calcite",
          "dripstone_block",
          "blackstone",
          "polished_blackstone",
          "chiseled_polished_blackstone",
          "gilded_blackstone",
          "basalt",
          "polished_basalt",
          "smooth_basalt",
          "netherrack",
          "soul_sand",
          "soul_soil",
          "magma_block",
          "obsidian",
          "crying_obsidian",
          "bedrock",
          "end_stone",
          "purpur_block",
          "purpur_pillar",
          "quartz_block",
          "quartz_pillar",
          "chiseled_quartz_block",
          "smooth_quartz",
          "sandstone",
          "chiseled_sandstone",
          "cut_sandstone",
          "smooth_sandstone",
          "red_sandstone",
          "chiseled_red_sandstone",
          "cut_red_sandstone",
          "smooth_red_sandstone",
          "prismarine",
          "dark_prismarine",
          "sea_lantern",
          "glowstone",
          "shroomlight",
          "redstone_lamp",
          "ochre_froglight",
          "verdant_froglight",
          "pearlescent_froglight",
          "dirt",
          "coarse_dirt",
          "rooted_dirt",
          "grass_block",
          "podzol",
          "mycelium",
          "dirt_path",
          "farmland",
          "mud",
          "packed_mud",
          "clay",
          "sand",
          "red_sand",
          "gravel",
          "suspicious_sand",
          "suspicious_gravel",
          "ice",
          "packed_ice",
          "blue_ice",
          "snow_block",
          "powder_snow",
          "sponge",
          "wet_sponge",
          "bookshelf",
          "hay_block",
          "melon",
          "pumpkin",
          "carved_pumpkin",
          "jack_o_lantern",
          "mushroom_stem",
          "nether_wart_block",
          "warped_wart_block",
          "bone_block",
          "honeycomb_block",
          "slime_block",
          "honey_block",
          "target",
          "note_block",
          "tnt",
          "crafting_table",
          "fletching_table",
          "cartography_table",
          "smithing_table",
          "loom",
          "lodestone",
          "ancient_debris",
          "amethyst_block",
          "budding_amethyst",
          "moss_block",
          "pale_moss_block",
          "sculk",
          "resin_block",
          "chiseled_resin_bricks",
          "resin_bricks",
          "bamboo_mosaic",
          "tinted_glass",
          "coal_block",
          "iron_block",
          "gold_block",
          "diamond_block",
          "emerald_block",
          "lapis_block",
          "redstone_block",
          "netherite_block",
          "copper_block",
          "raw_iron_block",
          "raw_gold_block",
          "raw_copper_block",
          "nether_brick_fence_post");

  private static final List<String> FULL_SUFFIXES =
      List.of(
          "_planks",
          "_log",
          "_wood",
          "_hyphae",
          "_stem",
          "_concrete",
          "_concrete_powder",
          "_wool",
          "_terracotta",
          "_bricks",
          "_tiles",
          "_ore",
          "_block",
          "_copper",
          "_basalt",
          "_deepslate",
          "_quartz",
          "_sandstone",
          "_prismarine",
          "_stone",
          "_leaves",
          "_mosaic",
          "_bulb",
          "_grate",
          "_chiseled_copper",
          "_stained_glass_block",
          "_nylium",
          "_blackstone",
          "_tuff",
          "_cobblestone",
          "_andesite",
          "_diorite",
          "_granite",
          "_purpur",
          "_shulker_box",
          "_glazed_terracotta");

  private static final List<Function<BlockState, Optional<Classified>>> RULES =
      List.of(
          BlockTable::flat,
          BlockTable::climbable,
          BlockTable::liquid,
          BlockTable::snow,
          BlockTable::slab,
          BlockTable::stairs,
          BlockTable::door,
          BlockTable::trapdoor,
          BlockTable::fenceGate,
          BlockTable::fenceOrWall,
          BlockTable::pane,
          BlockTable::clearFull,
          BlockTable::full);

  private BlockTable() {}

  /** Classifies a canonical block-state string, or throws naming the state. */
  public static Classified classify(String blockState) {
    var state = BlockState.parse(blockState);
    for (var rule : RULES) {
      var classified = rule.apply(state);
      if (classified.isPresent()) {
        return classified.get();
      }
    }
    throw new UnknownBlockStateException(
        "unknown block state " + blockState + "; add it to the rwfmap BlockTable");
  }

  private static Optional<Classified> flat(BlockState state) {
    if (PASSABLE_IDS.contains(state.id())
        || PASSABLE_SUFFIXES.stream().anyMatch(state::idEndsWith)) {
      return Optional.of(PASSABLE);
    }
    return Optional.empty();
  }

  private static Optional<Classified> climbable(BlockState state) {
    return LADDER_IDS.contains(state.id()) ? Optional.of(LADDER) : Optional.empty();
  }

  private static Optional<Classified> liquid(BlockState state) {
    return LIQUID_IDS.contains(state.id()) ? Optional.of(LIQUID) : Optional.empty();
  }

  /** One layer of snow is walked over; deeper snow is a block. */
  private static Optional<Classified> snow(BlockState state) {
    if (!state.id().equals("snow")) {
      return Optional.empty();
    }
    var layers = Integer.parseInt(state.property("layers"));
    return Optional.of(layers <= 1 ? PASSABLE : FULL);
  }

  private static Optional<Classified> slab(BlockState state) {
    if (!state.idEndsWith("_slab")) {
      return Optional.empty();
    }
    return Optional.of(
        switch (state.property("type")) {
          case "bottom" -> SLAB_BOTTOM;
          case "top" -> SLAB_TOP;
          case "double" -> FULL;
          default ->
              throw new UnknownBlockStateException(
                  "slab type " + state.property("type") + " is not bottom, top or double");
        });
  }

  private static Optional<Classified> stairs(BlockState state) {
    return state.idEndsWith("_stairs") ? Optional.of(STAIRS) : Optional.empty();
  }

  private static Optional<Classified> door(BlockState state) {
    if (!state.idEndsWith("_door")) {
      return Optional.empty();
    }
    return Optional.of(open(state) ? PASSABLE : FULL);
  }

  private static Optional<Classified> trapdoor(BlockState state) {
    if (!state.idEndsWith("_trapdoor")) {
      return Optional.empty();
    }
    if (open(state)) {
      return Optional.of(PASSABLE);
    }
    return Optional.of(
        switch (state.property("half")) {
          case "top" -> SLAB_TOP;
          case "bottom" -> SLAB_BOTTOM;
          default ->
              throw new UnknownBlockStateException(
                  "trapdoor half " + state.property("half") + " is not top or bottom");
        });
  }

  private static Optional<Classified> fenceGate(BlockState state) {
    if (!state.idEndsWith("_fence_gate")) {
      return Optional.empty();
    }
    return Optional.of(open(state) ? PASSABLE : FENCE);
  }

  private static Optional<Classified> fenceOrWall(BlockState state) {
    return state.idEndsWith("_fence") || state.idEndsWith("_wall")
        ? Optional.of(FENCE)
        : Optional.empty();
  }

  private static Optional<Classified> pane(BlockState state) {
    return PANE_IDS.contains(state.id()) || state.idEndsWith("_glass_pane")
        ? Optional.of(PANE)
        : Optional.empty();
  }

  /** Full blocks that are seen through: the glass family and barriers. */
  private static Optional<Classified> clearFull(BlockState state) {
    return CLEAR_FULL_IDS.contains(state.id()) || state.idEndsWith("_stained_glass")
        ? Optional.of(FULL_CLEAR)
        : Optional.empty();
  }

  private static Optional<Classified> full(BlockState state) {
    if (FULL_IDS.contains(state.id()) || FULL_SUFFIXES.stream().anyMatch(state::idEndsWith)) {
      return Optional.of(FULL);
    }
    return Optional.empty();
  }

  private static boolean open(BlockState state) {
    return switch (state.property("open")) {
      case "true" -> true;
      case "false" -> false;
      default ->
          throw new UnknownBlockStateException(
              "open=" + state.property("open") + " is not true or false");
    };
  }
}

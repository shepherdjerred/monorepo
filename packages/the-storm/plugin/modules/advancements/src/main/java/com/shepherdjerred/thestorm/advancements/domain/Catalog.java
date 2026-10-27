package com.shepherdjerred.thestorm.advancements.domain;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The Storm advancement tabs. The JSON files under {@code datapacks/quiet-iron-pick} match this
 * list. They share that pack with the quiet iron-pick override.
 */
public final class Catalog {

  public static final String NAMESPACE = "thestorm";

  // Assigned before ALL. Class init calls build(), and build() reads these numerals.
  private static final String[] ROMAN = {"I", "II", "III", "IV", "V"};

  private static final List<AdvancementDef> ALL = List.copyOf(validate(build()));

  private Catalog() {}

  public static List<AdvancementDef> all() {
    return ALL;
  }

  private static List<AdvancementDef> build() {
    var out = new ArrayList<AdvancementDef>();
    root(
        out,
        "a_survival",
        new Copy("The Storm", "Homes, quests, towns, and storm gear.", "minecraft:lightning_rod"),
        "minecraft:block/deepslate");
    child(
        out,
        "a_survival/home",
        "a_survival",
        new Copy("A place to return", "Save a home.", "minecraft:red_bed"));
    child(
        out,
        "a_survival/lock",
        "a_survival",
        new Copy("Locked away", "Lock a container you own.", "minecraft:iron_door"));
    chain(
        out,
        "a_survival",
        "a_survival/quest",
        new Lines(
            new String[] {"1", "10", "25", "50", "100"},
            new String[] {
              "Errand done",
              "Ten errands",
              "Twenty-five errands",
              "Fifty errands",
              "A hundred errands"
            },
            new String[] {
              "Finish a story, side, or track quest.",
              "Finish ten story, side, or track quests.",
              "Finish twenty-five story, side, or track quests.",
              "Finish fifty story, side, or track quests.",
              "Finish one hundred story, side, or track quests."
            },
            new String[] {
              "minecraft:writable_book",
              "minecraft:book",
              "minecraft:enchanted_book",
              "minecraft:knowledge_book",
              "minecraft:written_book"
            }));
    chain(
        out,
        "a_survival",
        "a_survival/town",
        new Lines(
            new String[] {"settled", "1", "25", "50", "100", "200"},
            new String[] {
              "Settled", "Claimed", "Growing town", "Established", "A large holding", "A landmark"
            },
            new String[] {
              "Found or join a town.",
              "Claim a chunk.",
              "Claim 25 chunks.",
              "Claim 50 chunks.",
              "Claim 100 chunks.",
              "Claim 200 chunks."
            },
            new String[] {
              "minecraft:oak_door",
              "minecraft:grass_block",
              "minecraft:bricks",
              "minecraft:bell",
              "minecraft:lodestone",
              "minecraft:beacon"
            }));
    chain(
        out,
        "a_survival",
        "a_survival/shard",
        new Lines(
            new String[] {"1", "2", "3", "4", "5"},
            new String[] {"Storm I", "Storm II", "Storm III", "Storm IV", "Storm V"},
            new String[] {
              "Carry Storm I gear.",
              "Carry Storm II gear.",
              "Carry Storm III gear.",
              "Carry Storm IV gear.",
              "Carry Storm V gear."
            },
            new String[] {
              "minecraft:amethyst_shard",
              "minecraft:prismarine_shard",
              "minecraft:echo_shard",
              "minecraft:nether_star",
              "minecraft:heart_of_the_sea"
            }));

    root(
        out,
        "b_tracks",
        new Copy("Tracks", "The five progression tracks.", "minecraft:experience_bottle"),
        "minecraft:block/bookshelf");
    track(out, "shopkeeper", "Shopkeeper", "minecraft:emerald");
    track(out, "mechanic", "Mechanic", "minecraft:redstone");
    track(out, "engineer", "Engineer", "minecraft:piston");
    track(out, "spellcaster", "Spellcaster", "minecraft:blaze_powder");
    track(out, "governor", "Governor", "minecraft:golden_helmet");

    root(
        out,
        "c_skills",
        new Copy("Skills", "The eleven skills.", "minecraft:iron_pickaxe"),
        "minecraft:block/stone");
    skill(out, "mining", "Mining", "minecraft:iron_pickaxe");
    skill(out, "woodcutting", "Woodcutting", "minecraft:iron_axe");
    skill(out, "excavation", "Excavation", "minecraft:iron_shovel");
    skill(out, "herbalism", "Herbalism", "minecraft:wheat");
    skill(out, "fishing", "Fishing", "minecraft:fishing_rod");
    skill(out, "swords", "Swords", "minecraft:iron_sword");
    skill(out, "axes", "Axes", "minecraft:diamond_axe");
    skill(out, "archery", "Archery", "minecraft:bow");
    skill(out, "unarmed", "Unarmed", "minecraft:leather");
    skill(out, "acrobatics", "Acrobatics", "minecraft:feather");
    skill(out, "repair", "Repair", "minecraft:anvil");

    root(
        out,
        "d_spells",
        new Copy("Spells", "Spells you have cast.", "minecraft:blaze_rod"),
        "minecraft:block/amethyst_block");
    child(
        out,
        "d_spells/first",
        "d_spells",
        new Copy("First spell", "Cast a spell.", "minecraft:blaze_rod"));
    spell(out, "mark", "Mark", "minecraft:compass");
    spell(out, "recall", "Recall", "minecraft:ender_pearl");
    spell(out, "haste", "Haste", "minecraft:sugar");
    spell(out, "firenova", "Fire Nova", "minecraft:fire_charge");
    spell(out, "cripple", "Cripple", "minecraft:spider_eye");
    spell(out, "confusion", "Confusion", "minecraft:fermented_spider_eye");
    spell(out, "roar", "Roar", "minecraft:goat_horn");
    spell(out, "silence", "Silence", "minecraft:sculk");
    spell(out, "dowse", "Dowse", "minecraft:bucket");
    spell(out, "cleanse", "Cleanse", "minecraft:milk_bucket");
    spell(out, "phase", "Phase", "minecraft:chorus_fruit");
    spell(out, "wall", "Wall", "minecraft:cobblestone");
    spell(out, "geyser", "Geyser", "minecraft:prismarine_crystals");
    spell(out, "stealth", "Stealth", "minecraft:phantom_membrane");
    spell(out, "farm", "Farm", "minecraft:wheat");
    spell(out, "forcepush", "Force Push", "minecraft:piston");
    spell(out, "disarm", "Disarm", "minecraft:shears");
    spell(out, "shadowstep", "Shadow Step", "minecraft:ender_eye");
    spell(out, "divine", "Divine", "minecraft:glowstone_dust");
    spell(out, "leap", "Leap", "minecraft:rabbit_foot");
    spell(out, "dawn", "Dawn", "minecraft:clock");
    spell(out, "dusk", "Dusk", "minecraft:candle");
    spell(out, "freeze", "Freeze", "minecraft:ice");
    spell(out, "drainlife", "Drain Life", "minecraft:ghast_tear");
    spell(out, "blink", "Blink", "minecraft:amethyst_shard");
    spell(out, "carpet", "Carpet", "minecraft:moss_carpet");
    spell(out, "entomb", "Entomb", "minecraft:dirt");
    spell(out, "purge", "Purge", "minecraft:glass_bottle");
    spell(out, "stormcall", "Storm Call", "minecraft:lightning_rod");
    spell(out, "ward", "Ward", "minecraft:shield");
    spell(out, "thunderclap", "Thunderclap", "minecraft:breeze_rod");
    spell(out, "chainlightning", "Chain Lightning", "minecraft:iron_chain");

    root(
        out,
        "e_arena",
        new Copy("Mob Arena", "Waves you have survived.", "minecraft:iron_sword"),
        "minecraft:block/polished_blackstone");
    chain(
        out,
        "e_arena",
        "e_arena/wave",
        new Lines(
            new String[] {"1", "10", "25", "40", "60"},
            new String[] {
              "Survived a wave", "Wave ten", "Wave twenty-five", "Wave forty", "Wave sixty"
            },
            new String[] {
              "Clear a wave.",
              "Clear wave ten.",
              "Clear wave twenty-five.",
              "Clear wave forty.",
              "Clear wave sixty."
            },
            new String[] {
              "minecraft:iron_sword",
              "minecraft:diamond_sword",
              "minecraft:shield",
              "minecraft:netherite_sword",
              "minecraft:nether_star"
            }));
    child(
        out,
        "e_arena/clear",
        "e_arena",
        new Copy("Last wave", "Clear an arena's final wave.", "minecraft:totem_of_undying"));

    root(
        out,
        "f_search",
        new Copy("Search and Destroy", "Red Warfare, over a career.", "minecraft:tnt"),
        "minecraft:block/red_concrete");
    chain(
        out,
        "f_search",
        "f_search/matches",
        new Lines(
            new String[] {"1", "25", "100"},
            new String[] {"In the fight", "Regular", "Veteran"},
            new String[] {
              "Play a Search and Destroy match.", "Play 25 matches.", "Play 100 matches."
            },
            new String[] {
              "minecraft:iron_sword", "minecraft:compass", "minecraft:netherite_chestplate"
            }));
    chain(
        out,
        "f_search/matches/1",
        "f_search/wins",
        new Lines(
            new String[] {"1", "10", "25", "50"},
            new String[] {"Round won", "Ten wins", "Twenty-five wins", "Fifty wins"},
            new String[] {
              "Win a round.", "Win ten rounds.", "Win twenty-five rounds.", "Win fifty rounds."
            },
            new String[] {
              "minecraft:gold_ingot",
              "minecraft:emerald",
              "minecraft:diamond",
              "minecraft:nether_star"
            }));
    chain(
        out,
        "f_search",
        "f_search/kills",
        new Lines(
            new String[] {"1", "25", "100", "250"},
            new String[] {
              "First blood", "Twenty-five kills", "A hundred kills", "Two hundred fifty kills"
            },
            new String[] {
              "Get a kill.",
              "Get twenty-five kills.",
              "Get a hundred kills.",
              "Get two hundred fifty kills."
            },
            new String[] {
              "minecraft:arrow",
              "minecraft:iron_axe",
              "minecraft:diamond_sword",
              "minecraft:netherite_sword"
            }));
    chain(
        out,
        "f_search",
        "f_search/assists",
        new Lines(
            new String[] {"10", "50"},
            new String[] {"Ten assists", "Fifty assists"},
            new String[] {"Get ten assists.", "Get fifty assists."},
            new String[] {"minecraft:lead", "minecraft:name_tag"}));
    chain(
        out,
        "f_search",
        "f_search/winstreak",
        new Lines(
            new String[] {"3", "5"},
            new String[] {"On a run", "Five straight"},
            new String[] {"Win three rounds in a row.", "Win five rounds in a row."},
            new String[] {"minecraft:firework_rocket", "minecraft:firework_star"}));
    child(
        out,
        "f_search/killstreak",
        "f_search",
        new Copy("Killstreak", "Earn a killstreak reward.", "minecraft:tnt"));
    return out;
  }

  private static void track(List<AdvancementDef> out, String id, String name, String icon) {
    var suffixes = new String[5];
    var titles = new String[5];
    var descriptions = new String[5];
    var icons = new String[5];
    for (var level = 1; level <= 5; level++) {
      suffixes[level - 1] = Integer.toString(level);
      titles[level - 1] = name + " " + ROMAN[level - 1];
      descriptions[level - 1] = "Reach " + name + " " + ROMAN[level - 1] + ".";
      icons[level - 1] = icon;
    }
    chain(out, "b_tracks", "b_tracks/" + id, new Lines(suffixes, titles, descriptions, icons));
  }

  private static void skill(List<AdvancementDef> out, String id, String name, String icon) {
    var levels = new int[] {100, 250, 500, 1000};
    var suffixes = new String[levels.length];
    var titles = new String[levels.length];
    var descriptions = new String[levels.length];
    var icons = new String[levels.length];
    for (var i = 0; i < levels.length; i++) {
      suffixes[i] = Integer.toString(levels[i]);
      titles[i] = name + " " + levels[i];
      descriptions[i] = "Reach " + name + " level " + levels[i] + ".";
      icons[i] = icon;
    }
    chain(out, "c_skills", "c_skills/" + id, new Lines(suffixes, titles, descriptions, icons));
  }

  private static void spell(List<AdvancementDef> out, String id, String title, String icon) {
    child(out, "d_spells/" + id, "d_spells", new Copy(title, "Cast " + title + ".", icon));
  }

  private static void chain(
      List<AdvancementDef> out, String parent, String directory, Lines lines) {
    var previous = parent;
    for (var i = 0; i < lines.suffixes().length; i++) {
      var path = directory + "/" + lines.suffixes()[i];
      child(
          out,
          path,
          previous,
          new Copy(lines.titles()[i], lines.descriptions()[i], lines.icons()[i]));
      previous = path;
    }
  }

  private static void root(List<AdvancementDef> out, String path, Copy copy, String background) {
    out.add(
        new AdvancementDef(
            path, null, copy.title(), copy.description(), copy.icon(), background, true));
  }

  private static void child(List<AdvancementDef> out, String path, String parent, Copy copy) {
    out.add(
        new AdvancementDef(
            path, parent, copy.title(), copy.description(), copy.icon(), null, false));
  }

  private static List<AdvancementDef> validate(List<AdvancementDef> defs) {
    if (defs.size() != 148) {
      throw new IllegalStateException("expected 148 advancements, found " + defs.size());
    }
    var paths = uniquePaths(defs);
    sameTabParents(defs, paths);
    return defs;
  }

  private static Set<String> uniquePaths(List<AdvancementDef> defs) {
    Set<String> paths = new LinkedHashSet<>();
    var roots = new ArrayList<String>();
    for (var def : defs) {
      if (!paths.add(def.path())) {
        throw new IllegalStateException("duplicate advancement " + def.path());
      }
      if (def.root()) {
        roots.add(def.path());
      }
    }
    if (!roots.equals(
        List.of("a_survival", "b_tracks", "c_skills", "d_spells", "e_arena", "f_search"))) {
      throw new IllegalStateException("tab roots: " + roots);
    }
    return paths;
  }

  private static void sameTabParents(List<AdvancementDef> defs, Set<String> paths) {
    for (var def : defs) {
      if (def.root()) {
        continue;
      }
      var parent = def.parent();
      if (parent == null || !paths.contains(parent)) {
        throw new IllegalStateException(def.path() + " parents a missing advancement");
      }
      var parentTab = parent.contains("/") ? parent.substring(0, parent.indexOf('/')) : parent;
      if (!def.tab().equals(parentTab)) {
        throw new IllegalStateException(def.path() + " parents another tab");
      }
    }
  }

  /** Parallel text for one chain. The arrays are the same length, in chain order. */
  private static final class Lines {
    private final String[] suffixes;
    private final String[] titles;
    private final String[] descriptions;
    private final String[] icons;

    private Lines(String[] suffixes, String[] titles, String[] descriptions, String[] icons) {
      this.suffixes = suffixes;
      this.titles = titles;
      this.descriptions = descriptions;
      this.icons = icons;
    }

    private String[] suffixes() {
      return suffixes;
    }

    private String[] titles() {
      return titles;
    }

    private String[] descriptions() {
      return descriptions;
    }

    private String[] icons() {
      return icons;
    }
  }

  /** The literal title, description, and vanilla item icon of one advancement. */
  private record Copy(String title, String description, String icon) {}
}

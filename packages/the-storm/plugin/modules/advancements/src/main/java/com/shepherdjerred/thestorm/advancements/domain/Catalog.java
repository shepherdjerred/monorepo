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
        new Copy("Spawn set", "Save a home.", "minecraft:red_bed"));
    child(
        out,
        "a_survival/lock",
        "a_survival",
        new Copy("Locked with LWC", "Lock a container you own.", "minecraft:iron_door"));
    chain(
        out,
        "a_survival",
        "a_survival/quest",
        new Lines(
            new String[] {"1", "10", "25", "50", "100"},
            new String[] {
              "May the odds", "Journal 3", "Winter is coming", "Allons-y", "The Odyssey"
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
              "A faction is born",
              "Land claimed",
              "Power is rising",
              "A second outpost",
              "Wilderness Bound",
              "Beaconator"
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
            new String[] {
              "Getting an Upgrade", "Acquire Hardware", "Enchanter", "The Beginning.", "Overpowered"
            },
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
        new Copy("I choose you", "Cast a spell.", "minecraft:blaze_rod"));
    spell(out, "mark", new Copy("A Pokemon Center", "Cast Mark.", "minecraft:compass"));
    spell(out, "recall", new Copy("Teleport", "Cast Recall.", "minecraft:ender_pearl"));
    spell(out, "haste", new Copy("Agility", "Cast Haste.", "minecraft:sugar"));
    spell(out, "firenova", new Copy("Lava Plume", "Cast Fire Nova.", "minecraft:fire_charge"));
    spell(out, "cripple", new Copy("String Shot", "Cast Cripple.", "minecraft:spider_eye"));
    spell(
        out,
        "confusion",
        new Copy("Confuse Ray", "Cast Confusion.", "minecraft:fermented_spider_eye"));
    spell(out, "roar", new Copy("Roar", "Cast Roar.", "minecraft:goat_horn"));
    spell(out, "silence", new Copy("Disable", "Cast Silence.", "minecraft:sculk"));
    spell(out, "dowse", new Copy("Rain Dance", "Cast Dowse.", "minecraft:bucket"));
    spell(out, "cleanse", new Copy("Heal Bell", "Cast Cleanse.", "minecraft:milk_bucket"));
    spell(out, "phase", new Copy("Phantom Force", "Cast Phase.", "minecraft:chorus_fruit"));
    spell(out, "wall", new Copy("Reflect", "Cast Wall.", "minecraft:cobblestone"));
    spell(out, "geyser", new Copy("Water Spout", "Cast Geyser.", "minecraft:prismarine_crystals"));
    spell(out, "stealth", new Copy("Double Team", "Cast Stealth.", "minecraft:phantom_membrane"));
    spell(out, "farm", new Copy("Grassy Terrain", "Cast Farm.", "minecraft:wheat"));
    spell(out, "forcepush", new Copy("Whirlwind", "Cast Force Push.", "minecraft:piston"));
    spell(out, "disarm", new Copy("Knock Off", "Cast Disarm.", "minecraft:shears"));
    spell(out, "shadowstep", new Copy("Shadow Sneak", "Cast Shadow Step.", "minecraft:ender_eye"));
    spell(out, "divine", new Copy("Dowsing Machine", "Cast Divine.", "minecraft:glowstone_dust"));
    spell(out, "leap", new Copy("Bounce", "Cast Leap.", "minecraft:rabbit_foot"));
    spell(out, "dawn", new Copy("Morning Sun", "Cast Dawn.", "minecraft:clock"));
    spell(out, "dusk", new Copy("Moonlight", "Cast Dusk.", "minecraft:candle"));
    spell(out, "freeze", new Copy("Ice Beam", "Cast Freeze.", "minecraft:ice"));
    spell(out, "drainlife", new Copy("Giga Drain", "Cast Drain Life.", "minecraft:ghast_tear"));
    spell(out, "blink", new Copy("Extreme Speed", "Cast Blink.", "minecraft:amethyst_shard"));
    spell(out, "carpet", new Copy("Magnet Rise", "Cast Carpet.", "minecraft:moss_carpet"));
    spell(out, "entomb", new Copy("Sand Tomb", "Cast Entomb.", "minecraft:dirt"));
    spell(out, "purge", new Copy("Luster Purge", "Cast Purge.", "minecraft:glass_bottle"));
    spell(out, "stormcall", new Copy("Thunder", "Cast Storm Call.", "minecraft:lightning_rod"));
    spell(out, "ward", new Copy("Protect", "Cast Ward.", "minecraft:shield"));
    spell(out, "thunderclap", new Copy("Boomburst", "Cast Thunderclap.", "minecraft:breeze_rod"));
    spell(
        out,
        "chainlightning",
        new Copy("Thunderbolt", "Cast Chain Lightning.", "minecraft:iron_chain"));

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
              "The power is on", "Quick Revive", "Juggernog", "Pack-a-Punch", "The Thundergun"
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
        new Copy(
            "No more room in hell", "Clear an arena's final wave.", "minecraft:totem_of_undying"));

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
            new String[] {"Bravo Six, going dark", "Check your corners", "All ghillied up"},
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
            new String[] {"Target down", "UAV online", "Airstrike inbound", "Helicopter inbound"},
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
            new String[] {"First blood", "Tango down", "Headshot", "The numbers, Mason"},
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
            new String[] {"On your six", "Price has you"},
            new String[] {"Get ten assists.", "Get fifty assists."},
            new String[] {"minecraft:lead", "minecraft:name_tag"}));
    chain(
        out,
        "f_search",
        "f_search/winstreak",
        new Lines(
            new String[] {"3", "5"},
            new String[] {"Stay frosty", "Not one step back"},
            new String[] {"Win three rounds in a row.", "Win five rounds in a row."},
            new String[] {"minecraft:firework_rocket", "minecraft:firework_star"}));
    child(
        out,
        "f_search/killstreak",
        "f_search",
        new Copy("Care package inbound", "Earn a killstreak reward.", "minecraft:tnt"));
    return out;
  }

  private static void track(List<AdvancementDef> out, String id, String name, String icon) {
    var flavor = trackTitles(id);
    var suffixes = new String[5];
    var titles = new String[5];
    var descriptions = new String[5];
    var icons = new String[5];
    for (var level = 1; level <= 5; level++) {
      suffixes[level - 1] = Integer.toString(level);
      titles[level - 1] = flavor[level - 1];
      descriptions[level - 1] = "Reach " + name + " " + ROMAN[level - 1] + ".";
      icons[level - 1] = icon;
    }
    chain(out, "b_tracks", "b_tracks/" + id, new Lines(suffixes, titles, descriptions, icons));
  }

  private static String[] trackTitles(String id) {
    return switch (id) {
      case "shopkeeper" ->
          new String[] {
            "Dunder Mifflin",
            "Sell me this pen",
            "Take my money",
            "World's best boss",
            "I declare bankruptcy"
          };
      case "mechanic" ->
          new String[] {
            "A line of dust", "The repeater", "Sticky piston", "A BUD switch", "Observer block"
          };
      case "engineer" ->
          new String[] {"A dirt hut", "//paste", "A command block", "Etho's clock", "SethBling"};
      case "spellcaster" ->
          new String[] {
            "Trust no one",
            "The cipher wheel",
            "Not what he seems",
            "A deal with Bill",
            "Weirdmageddon"
          };
      case "governor" ->
          new String[] {
            "You're finally awake",
            "A stolen sweetroll",
            "Speak to the jarl",
            "Dragonsreach",
            "The Cloud District"
          };
      default -> throw new IllegalStateException("track titles: " + id);
    };
  }

  private static void skill(List<AdvancementDef> out, String id, String name, String icon) {
    var levels = new int[] {100, 250, 500, 1000};
    var flavor = skillTitles(id);
    var suffixes = new String[levels.length];
    var titles = new String[levels.length];
    var descriptions = new String[levels.length];
    var icons = new String[levels.length];
    for (var i = 0; i < levels.length; i++) {
      suffixes[i] = Integer.toString(levels[i]);
      titles[i] = flavor[i];
      descriptions[i] = "Reach " + name + " level " + levels[i] + ".";
      icons[i] = icon;
    }
    chain(out, "c_skills", "c_skills/" + id, new Lines(suffixes, titles, descriptions, icons));
  }

  private static String[] skillTitles(String id) {
    return switch (id) {
      case "mining" -> new String[] {"Time to Mine!", "Branch mining", "DIAMONDS!", "Ice Caves"};
      case "woodcutting" ->
          new String[] {"Getting Wood", "Punching trees", "Dark oak", "Treecapitator"};
      case "excavation" ->
          new String[] {"Straight down", "This is fine", "A mineshaft", "Chaos Cubed"};
      case "herbalism" ->
          new String[] {
            "Blue mountain flower", "Wheat and a toe", "The White Phial", "Jarrin root"
          };
      case "fishing" -> new String[] {"Old Rod", "Good Rod", "Super Rod", "Gyarados"};
      case "swords" ->
          new String[] {"Iron dagger", "The Skyforge", "Dawnbreaker", "Mehrunes' Razor"};
      case "axes" -> new String[] {"A woodcutter's axe", "Orcish", "Wuuthrad", "Daedric"};
      case "archery" ->
          new String[] {"Arrow in the knee", "The sneak archer", "Bound bow", "Auriel's Bow"};
      case "unarmed" ->
          new String[] {
            "Gloves of the Pugilist", "Fists of Steel", "A Khajiit's claws", "Had enough?"
          };
      case "acrobatics" ->
          new String[] {"A two-block jump", "Water bucket", "MLG clutch", "The Dropper"};
      case "repair" -> new String[] {"The anvil", "Prior work", "Too Expensive", "Mending"};
      default -> throw new IllegalStateException("skill titles: " + id);
    };
  }

  private static void spell(List<AdvancementDef> out, String id, Copy copy) {
    child(out, "d_spells/" + id, "d_spells", copy);
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

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
        new Copy("Leave a light on", "Save a home.", "minecraft:red_bed"));
    child(
        out,
        "a_survival/lock",
        "a_survival",
        new Copy("Hands off", "Lock a container you own.", "minecraft:iron_door"));
    chain(
        out,
        "a_survival",
        "a_survival/quest",
        new Lines(
            new String[] {"1", "10", "25", "50", "100"},
            new String[] {
              "The first errand",
              "Ten errands kept",
              "The journal thickens",
              "Known on the road",
              "The hundredth telling"
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
              "A name on the gate",
              "This ground is ours",
              "The fence moves out",
              "A bell in the square",
              "The border keeps moving",
              "They steer by you"
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
              "A crackle in the pack",
              "Storm, answering",
              "Thunder, carried",
              "Dressed for weather",
              "The storm, worn"
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
        new Copy("A first casting", "Cast a spell.", "minecraft:blaze_rod"));
    spell(out, "mark", new Copy("This place, remembered", "Cast Mark.", "minecraft:compass"));
    spell(out, "recall", new Copy("Back to the Mark", "Cast Recall.", "minecraft:ender_pearl"));
    spell(out, "haste", new Copy("Quick hands", "Cast Haste.", "minecraft:sugar"));
    spell(out, "firenova", new Copy("A ring of flame", "Cast Fire Nova.", "minecraft:fire_charge"));
    spell(
        out, "cripple", new Copy("Slowed where you look", "Cast Cripple.", "minecraft:spider_eye"));
    spell(
        out,
        "confusion",
        new Copy("They turn on each other", "Cast Confusion.", "minecraft:fermented_spider_eye"));
    spell(out, "roar", new Copy("All eyes this way", "Cast Roar.", "minecraft:goat_horn"));
    spell(out, "silence", new Copy("The cast stops", "Cast Silence.", "minecraft:sculk"));
    spell(out, "dowse", new Copy("Rain on the fire", "Cast Dowse.", "minecraft:bucket"));
    spell(out, "cleanse", new Copy("Washed clean", "Cast Cleanse.", "minecraft:milk_bucket"));
    spell(out, "phase", new Copy("Through that wall", "Cast Phase.", "minecraft:chorus_fruit"));
    spell(out, "wall", new Copy("A wall, then rubble", "Cast Wall.", "minecraft:cobblestone"));
    spell(
        out,
        "geyser",
        new Copy("Water, from below", "Cast Geyser.", "minecraft:prismarine_crystals"));
    spell(
        out, "stealth", new Copy("Gone from sight", "Cast Stealth.", "minecraft:phantom_membrane"));
    spell(out, "farm", new Copy("Ripe, all at once", "Cast Farm.", "minecraft:wheat"));
    spell(
        out,
        "forcepush",
        new Copy("Everything steps back", "Cast Force Push.", "minecraft:piston"));
    spell(out, "disarm", new Copy("The weapon leaves", "Cast Disarm.", "minecraft:shears"));
    spell(out, "shadowstep", new Copy("Behind them", "Cast Shadow Step.", "minecraft:ender_eye"));
    spell(
        out, "divine", new Copy("The diamonds answer", "Cast Divine.", "minecraft:glowstone_dust"));
    spell(out, "leap", new Copy("A soft bound", "Cast Leap.", "minecraft:rabbit_foot"));
    spell(out, "dawn", new Copy("Morning, privately", "Cast Dawn.", "minecraft:clock"));
    spell(out, "dusk", new Copy("Evening, privately", "Cast Dusk.", "minecraft:candle"));
    spell(out, "freeze", new Copy("Held in the frost", "Cast Freeze.", "minecraft:ice"));
    spell(out, "drainlife", new Copy("Life, borrowed", "Cast Drain Life.", "minecraft:ghast_tear"));
    spell(
        out,
        "blink",
        new Copy("Where you were looking", "Cast Blink.", "minecraft:amethyst_shard"));
    spell(out, "carpet", new Copy("Held up, briefly", "Cast Carpet.", "minecraft:moss_carpet"));
    spell(out, "entomb", new Copy("Glass, for a moment", "Cast Entomb.", "minecraft:dirt"));
    spell(out, "purge", new Copy("Scoured in light", "Cast Purge.", "minecraft:glass_bottle"));
    spell(
        out,
        "stormcall",
        new Copy("Lightning, where it rains", "Cast Storm Call.", "minecraft:lightning_rod"));
    spell(out, "ward", new Copy("They cannot come in", "Cast Ward.", "minecraft:shield"));
    spell(
        out,
        "thunderclap",
        new Copy("Thunder, outward", "Cast Thunderclap.", "minecraft:breeze_rod"));
    spell(
        out,
        "chainlightning",
        new Copy("It leaps onward", "Cast Chain Lightning.", "minecraft:iron_chain"));

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
              "The first wave breaks",
              "The tenth wave",
              "Still in the arena",
              "Forty waves deep",
              "Sixty, still up"
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
        new Copy("The last of them", "Clear an arena's final wave.", "minecraft:totem_of_undying"));

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
            new String[] {"The round is live", "A regular by now", "A hundred rounds in"},
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
            new String[] {
              "The round is yours", "Ten rounds taken", "A habit of winning", "Fifty rounds taken"
            },
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
              "First blood", "The lane remembers", "A hundred down", "The tally won't fit"
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
            new String[] {"You set it up", "Always in the play"},
            new String[] {"Get ten assists.", "Get fifty assists."},
            new String[] {"minecraft:lead", "minecraft:name_tag"}));
    chain(
        out,
        "f_search",
        "f_search/winstreak",
        new Lines(
            new String[] {"3", "5"},
            new String[] {"Three straight", "Five, unbroken"},
            new String[] {"Win three rounds in a row.", "Win five rounds in a row."},
            new String[] {"minecraft:firework_rocket", "minecraft:firework_star"}));
    child(
        out,
        "f_search/killstreak",
        "f_search",
        new Copy("The streak pays", "Earn a killstreak reward.", "minecraft:tnt"));
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
            "Open for business",
            "The emerald sticks",
            "A shop with regulars",
            "Name your price",
            "The market bends"
          };
      case "mechanic" ->
          new String[] {
            "A taste for redstone",
            "The circuit closes",
            "True clockwork",
            "The machine agrees",
            "Nothing stays jammed"
          };
      case "engineer" ->
          new String[] {
            "A first piston", "Measured twice", "Load-bearing", "The whole works", "Built to last"
          };
      case "spellcaster" ->
          new String[] {
            "The page turns",
            "Reagents ready",
            "The cast lands clean",
            "The words stay",
            "Ink and thunder"
          };
      case "governor" ->
          new String[] {
            "A voice in the hall",
            "The charter holds",
            "Called to account",
            "The town listens",
            "Governor, properly"
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
      case "mining" ->
          new String[] {
            "The vein gives", "Deeper than comfort", "Ore under the nails", "The mountain yields"
          };
      case "woodcutting" ->
          new String[] {"A clean fell", "The stand thins", "Among the stumps", "Old growth"};
      case "excavation" ->
          new String[] {
            "Earth, moved", "A serious hole", "The ground gives way", "Down through the map"
          };
      case "herbalism" ->
          new String[] {
            "The first green", "A careful harvest", "The row knows you", "Green to the elbow"
          };
      case "fishing" ->
          new String[] {
            "A tug on the line", "Where they bite", "Patient water", "The lake pays up"
          };
      case "swords" ->
          new String[] {
            "A working edge", "Steel, by habit", "The blade fits", "The point finds them"
          };
      case "axes" ->
          new String[] {
            "A clean split", "Weight behind it", "The chop lands", "Nothing left standing"
          };
      case "archery" ->
          new String[] {"Nock and loose", "A quiet shot", "The arrow gets there", "Already aiming"};
      case "unarmed" ->
          new String[] {"Empty hands", "No steel required", "The fist learns", "Armed enough"};
      case "acrobatics" ->
          new String[] {
            "You meant to fall", "The drop negotiates", "Feet first", "Gravity looks away"
          };
      case "repair" ->
          new String[] {
            "Once across the anvil", "Good as it was", "The crack closes", "Mended for good"
          };
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

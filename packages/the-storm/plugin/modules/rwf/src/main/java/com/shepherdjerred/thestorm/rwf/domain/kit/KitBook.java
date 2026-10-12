// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/kits/*.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java, the
// kit order); see packages/the-storm/NOTICE. Sapper, Saboteur, Spotter, Grappler, Bannerman,
// Engineer, Tracker and Decoy are new to The Storm.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseType;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Every kit a match offers: Red Warfare's twenty-five and The Storm's eight, in the kit menu's
 * order. Red Warfare's own menu listed its kits in {@code SearchAndDestroy}'s order (Trooper,
 * Berserker, Demolitions, ... Bleeder); Equality, Inertia and Sacrificial, which it never offered
 * in play, follow, and the new kits close the list. The module's KITS.md describes every one.
 *
 * <p>Six of Red Warfare's kits stay free for good: Trooper, Longbow, Shortbow, Rewind, Medic and
 * Teleporter. Every other kit is bought with Red Warfare credits at its original price. A kit's
 * {@link KitTier} follows its price: up to 200 credits is basic, up to 350 mid, and more advanced.
 */
public final class KitBook {

  private static final String RED = "#FF0000";
  private static final String AQUA = "#00FFFF";
  private static final String WHITE = "#FFFFFF";
  private static final String BLACK = "#000000";
  private static final String DARK = "#2B2B2B";

  public static final KitSpec TROOPER =
      kit(
          new Card(
              "trooper",
              "Trooper",
              // Red Warfare's words: five golden apples, though it gave three.
              "The kit that sets the standards for all others. It receives a set of iron armor and an"
                  + " iron sword, along with five golden apples with which it can quickly recover"
                  + " from fights.",
              0,
              KitTier.BASIC),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD").enchanted("sharpness", 1),
                  ItemSpec.of("GOLDEN_APPLE", 3)),
              fullSet("IRON"),
              Optional.empty()),
          new KitSpec.Menu(
              "IRON_SWORD",
              List.of(
                  "Iron sword with Sharpness I",
                  "3 golden apples to recover",
                  "Full iron armour")));

  public static final KitSpec BERSERKER =
      kit(
          new Card(
              "berserker",
              "Berserker",
              "An offensive kit with a powerful axe and low armor. Its damage increases by half a heart"
                  + " every kill as it works up a bloodlust.",
              400,
              KitTier.ADVANCED),
          gear(
              List.of(
                  ItemSpec.of("IRON_AXE").enchanted("sharpness", 2), ItemSpec.of("COOKED_BEEF", 2)),
              List.of(
                  ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("IRON_HELMET", ArmorSlot.HELMET)),
              Optional.of("berserker")),
          new KitSpec.Menu(
              "DIAMOND_AXE",
              List.of(
                  "Iron axe with Sharpness II", "+0.7 damage per kill, up to +7", "No leggings")));

  public static final KitSpec DEMOLITIONS =
      kit(
          new Card(
              "demolitions",
              "Demolitions",
              "A kit equipped with a flaming sword and two landmines which it can set. When triggered"
                  + " by an enemy, they will explode, dealing severe damage! Additionally, it can fuse"
                  + " and defuse bombs twice as fast!",
              300,
              KitTier.MID),
          gear(
              Optional.of(new FuseBonus(FuseType.BOMB_SPEED, 5)),
              List.of(
                  ItemSpec.of("IRON_SWORD")
                      .named("Flaming Sword", "red")
                      .enchanted("fire_aspect", 2),
                  ItemSpec.of("STONE_PRESSURE_PLATE", 2).named("Landmine", "yellow")),
              List.of(
                  ItemSpec.armor("GOLDEN_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("demolitions")),
          new KitSpec.Menu(
              "STONE_PRESSURE_PLATE",
              List.of(
                  "Fuse with Bomb Speed V",
                  "Fire Aspect II sword",
                  "2 landmines that blow up enemies")));

  public static final KitSpec DWARF =
      kit(
          new Card(
              "dwarf",
              "Dwarf",
              "A defensive kit that gains power by sneaking. As it levels up, it gets stronger and"
                  + " stronger, but there is a cost. The more powerful a dwarf is, the slower it gets."
                  + " When not sneaking, it will lose power at the same rate as it gained, with a much"
                  + " higher cost for sprinting.",
              500,
              KitTier.ADVANCED),
          gear(List.of(ItemSpec.of("IRON_SWORD")), fullSet("IRON"), Optional.of("dwarf")),
          new KitSpec.Menu(
              "EXPERIENCE_BOTTLE",
              List.of(
                  "Sneak to level up your gear",
                  "Levels add Sharpness and Protection",
                  "Strong dwarves are slow")));

  public static final KitSpec EXPLOSIVE =
      kit(
          new Card(
              "explosive",
              "Explosive",
              "An offensive kit equipped with RPGs and grenades. When launched, RPGs will soar through"
                  + " the air until they make contact, then explode. Beware, because explosives can be"
                  + " damaged by their own RPGs. Grenades will explode a short time after being"
                  + " thrown. Though they can't be thrown as far or deal as much damage, you will get"
                  + " more over time and can throw multiple at once.",
              150,
              KitTier.BASIC),
          gear(
              List.of(
                  ItemSpec.of("STONE_SWORD").enchanted("knockback", 1),
                  ItemSpec.of("EGG", 5).named("RPG", "yellow"),
                  ItemSpec.of("FIREWORK_STAR", 10)
                      .named("Grenade", "yellow")
                      .dyed(ItemLook.TEAM_DYE)),
              List.of(
                  ItemSpec.armor("DIAMOND_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("GOLDEN_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("GOLDEN_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("DIAMOND_HELMET", ArmorSlot.HELMET)),
              Optional.of("explosive")),
          new KitSpec.Menu(
              "FIREWORK_STAR",
              "#FF0000",
              List.of("5 RPGs that explode on contact", "Grenades that refill over time")));

  public static final KitSpec GHOST =
      kit(
          new Card(
              "ghost",
              "Ghost",
              "This kit is invisible and can sneak around unseen by the enemy, but its invisibility is"
                  + " not perfect. Held items, sprint particles, flames, and arrows will all reveal a"
                  + " ghost's presence. While it has no armor, it is given enderpearls to help travel"
                  + " around and make hasty escapes.",
              150,
              KitTier.BASIC),
          gear(
              List.of(
                  ItemSpec.of("GOLDEN_SWORD").enchanted("sharpness", 2),
                  ItemSpec.gap(),
                  ItemSpec.of("ENDER_PEARL", 4)),
              List.of(),
              Optional.of("ghost")),
          new KitSpec.Menu(
              "GHAST_TEAR",
              List.of(
                  "Invisible, but held items show",
                  "Golden sword with Sharpness II",
                  "4 ender pearls, no armour")));

  public static final KitSpec JUGGERNAUT =
      kit(
          new Card(
              "juggernaut",
              "Juggernaut",
              "A defensive kit that will only take a fraction of the normal melee and ranged damage it"
                  + " would normally take with an extra 5 hearts!\nJuggernauts however will still"
                  + " suffer from the damage it would normally take from other sources, such as"
                  + " fall.\nAdditionally, due to its heavy armor, it's hard to knock a juggernaut"
                  + " back.\nThis comes at great cost to its mobility, as it cannot sprint.",
              350,
              KitTier.MID),
          gear(
              List.of(ItemSpec.of("STONE_SWORD")),
              List.of(
                  ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("DIAMOND_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("IRON_HELMET", ArmorSlot.HELMET)),
              Optional.of("juggernaut")),
          new KitSpec.Menu(
              "DIAMOND_CHESTPLATE",
              List.of("15 hearts, takes 60% of hits", "Hard to knock back", "Cannot sprint")));

  public static final KitSpec LONGBOW =
      kit(
          new Card(
              "longbow",
              "Longbow",
              "A supporting archer, this kit receives a bow that will send enemies flying.",
              0,
              KitTier.BASIC),
          gear(
              List.of(
                  ItemSpec.of("STONE_SWORD"),
                  ItemSpec.of("BOW").enchanted("infinity", 1).enchanted("punch", 3),
                  ItemSpec.of("ARROW")),
              archerArmor(),
              Optional.empty()),
          new KitSpec.Menu(
              "BOW",
              List.of(
                  "Bow with Punch III and Infinity", "Stone sword", "Iron and chainmail armour")));

  public static final KitSpec MEDIC =
      kit(
          new Card(
              "medic",
              "Medic",
              "This supportive kit can heal allies with its wand, but it has a limit of 25 hearts per"
                  + " player.\nAfter that, they can only heal minorly by giving regeneration.\nTo"
                  + " heal more efficiently, medics can see the overall health of every player over"
                  + " their heads.\n\n§4§lThis kit loses its healing ability in small games with"
                  + " less than 20 players",
              0,
              KitTier.MID),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD"),
                  ItemSpec.of("BLAZE_ROD").named("", "gold"),
                  ItemSpec.of("GOLDEN_APPLE", 20)),
              fullSet("GOLDEN"),
              Optional.of("medic")),
          new KitSpec.Menu(
              "GOLDEN_APPLE",
              List.of(
                  "Wand heals nearby allies",
                  "20 golden apples, full gold",
                  "Sees everyone's health",
                  "No healing at 20 players or fewer")));

  public static final KitSpec PYRO =
      kit(
          new Card(
              "pyro",
              "Pyro",
              "A master of fire, this kit is given a flaming bow and sword, and fire resistant leather"
                  + " armor.",
              200,
              KitTier.BASIC),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD")
                      .enchanted("fire_aspect", 2)
                      .named("Molten Sword", "red"),
                  ItemSpec.of("BOW")
                      .enchanted("flame", 2)
                      .enchanted("infinity", 1)
                      .named("Charred Bow", "red"),
                  ItemSpec.of("ARROW")),
              List.of(
                  fireproof(ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS)),
                  fireproof(ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS).dyed(RED)),
                  fireproof(ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE).dyed(RED)),
                  fireproof(ItemSpec.armor("LEATHER_HELMET", ArmorSlot.HELMET).dyed(RED))),
              Optional.empty()),
          new KitSpec.Menu(
              "FLINT_AND_STEEL",
              List.of("Fire Aspect II sword", "Flame II bow", "Fire and blast resistant leather")));

  public static final KitSpec REWIND =
      kit(
          new Card(
              "rewind",
              "Rewind",
              "This kit is a master of hitting and running, as it has a magical clock that will"
                  + " teleport it where it was 30 seconds in the past. While health is unchanged, if"
                  + " the user was on fire, it will be put out like it never existed.",
              0,
              KitTier.MID),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD"), ItemSpec.of("CLOCK").named("Time Machine", "gold")),
              List.of(
                  ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE)
                      .enchanted("protection", 1),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("rewind")),
          new KitSpec.Menu(
              "CLOCK",
              List.of("Time Machine: back 30 seconds", "Iron sword", "Iron and chainmail armour")));

  public static final KitSpec SHORTBOW =
      kit(
          new Card(
              "shortbow",
              "Shortbow",
              "A powerful archer, this kit receives a bow with which it deals precise damage.",
              0,
              KitTier.BASIC),
          gear(
              List.of(
                  ItemSpec.of("WOODEN_SWORD").enchanted("knockback", 1),
                  ItemSpec.of("BOW").enchanted("infinity", 1).enchanted("power", 2),
                  ItemSpec.of("ARROW")),
              archerArmor(),
              Optional.empty()),
          new KitSpec.Menu(
              "BOW",
              List.of(
                  "Bow with Power II and Infinity",
                  "Wooden sword with Knockback I",
                  "Iron and chainmail armour")));

  public static final KitSpec SPY =
      kit(
          new Card(
              "spy",
              "Spy",
              "A sneaky kit that always looks like the team of the view. He looks like a trooper!",
              250,
              KitTier.MID),
          gear(List.of(ItemSpec.of("IRON_SWORD")), fullSet("IRON"), Optional.of("spy")),
          new KitSpec.Menu(
              "SKELETON_SKULL",
              List.of("Every viewer sees you on their team", "Shown as a Trooper", "Iron gear")));

  public static final KitSpec TELEPORTER =
      kit(
          new Card(
              "teleporter",
              "Teleporter",
              "A supportive kit that can create teleporters to transfer their team across the map."
                  + " Step on one and sneak to use it! Beware, the enemies can easily break the"
                  + " teleporters.",
              0,
              KitTier.MID),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD"),
                  ItemSpec.of("QUARTZ")
                      .named("Teleport Creator", "blue")
                      .lore("green", "Right click on ground to create teleporter"),
                  ItemSpec.of("MAP")
                      .named("Remote Teleporter", "blue")
                      .lore(
                          "green",
                          "Right click with this to open a menu where you can select one of your"
                              + " teammates to create a teleporter to",
                          "You can also destroy all existing teleporters with this!")),
              fullSet("IRON"),
              Optional.of("teleporter")),
          new KitSpec.Menu(
              "SPAWNER",
              List.of(
                  "Place two linked teleporters",
                  "Allies sneak on one to cross",
                  "Remote: place one under an ally")));

  public static final KitSpec VAMPIRE =
      kit(
          new Card(
              "vampire",
              "Vampire",
              "A kit that must pick its early kills carefully, as it only starts with 8 hearts."
                  + " However, every kill grants it a vital reward of 2 hearts, with a maximum of 20.",
              300,
              KitTier.MID),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD")
                      .named("Vampiric Sword", "red")
                      .enchanted("sharpness", 1)),
              fullSet("IRON"),
              Optional.of("vampire")),
          new KitSpec.Menu(
              "RED_DYE",
              List.of(
                  "Starts with 8 hearts",
                  "A kill adds a heart and Regeneration",
                  "Up to 20 hearts")));

  public static final KitSpec VENOM =
      kit(
          new Card(
              "venom",
              "Venom",
              "An offensive kit that excels at hit and runs. Its blade is coated in deadly poison and"
                  + " paralyzer, making every hit it lands poison its foe and slow them down!",
              400,
              KitTier.ADVANCED),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD")
                      .named("Poisoned Sword", "dark_green")
                      .glinting()
                      .lore("gray", "", "Venom I")),
              List.of(
                  ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("GOLDEN_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("venom")),
          new KitSpec.Menu(
              "POTION",
              "#4E9331",
              List.of("Hits poison and slow for 6 seconds", "Iron, gold and chainmail")));

  public static final KitSpec WARPER =
      kit(
          new Card(
              "warper",
              "Warper",
              "A supportive kit, it has the ability to warp a group of enemies to where it was"
                  + " standing 10 seconds ago, making it useful against an otherwise strong defense.",
              250,
              KitTier.MID),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD").enchanted("sharpness", 1),
                  ItemSpec.of("BLAZE_ROD").named("Warper's Wand", "gold")),
              fullSet("IRON"),
              Optional.of("warper")),
          new KitSpec.Menu(
              "BLAZE_ROD",
              List.of(
                  "Wand warps nearby enemies to",
                  "where you stood 10 seconds ago",
                  "30 second recharge")));

  public static final KitSpec NINJA =
      kit(
          new Card(
              "ninja",
              "Ninja",
              "The ninja starts with enderpearls and can sprint about the map with a speed boost\nHe"
                  + " is known as one who can outrun the stronger warriors\nWith fall protection,"
                  + " he's not afraid of heights!",
              200,
              KitTier.BASIC),
          gear(
              List.of(ItemSpec.of("IRON_SWORD"), ItemSpec.of("ENDER_PEARL", 6)),
              List.of(
                  ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS)
                      .enchanted("feather_falling", 2),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("IRON_HELMET", ArmorSlot.HELMET)),
              Optional.of("ninja")),
          new KitSpec.Menu(
              "ENDER_PEARL",
              List.of("Speed II and Night Vision", "6 ender pearls", "Feather Falling II boots")));

  public static final KitSpec FROST =
      kit(
          new Card(
              "frost",
              "Frost",
              "Master of ice and frost, this special guy can freeze the hands of your enemies for 10"
                  + " seconds!\nWhen frozen, your enemies cannot switch items or use their offhand!",
              150,
              KitTier.BASIC),
          gear(
              List.of(ItemSpec.of("IRON_SWORD")),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS).dyed(AQUA),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS).dyed(AQUA),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE).dyed(AQUA),
                  ItemSpec.armor("LEATHER_HELMET", ArmorSlot.HELMET).dyed(AQUA)),
              Optional.of("frost")),
          new KitSpec.Menu(
              "ICE",
              List.of(
                  "Hits freeze enemy hands for 10s",
                  "16 second recharge",
                  "Frost armour softens blows")));

  public static final KitSpec SKINNER =
      kit(
          new Card(
              "skinner",
              "Skinner",
              "A stealth fighter kit which gains the nametag and nametag color of any enemy slain"
                  + " nearby.\nMuch like an adaptive Spy.\nEvery kill they are defenseless for 3"
                  + " seconds.",
              300,
              KitTier.MID),
          gear(
              List.of(ItemSpec.of("IRON_SWORD").enchanted("silk_touch", 1)),
              fullSet("IRON"),
              Optional.of("skinner")),
          new KitSpec.Menu(
              "LEATHER_CHESTPLATE",
              "#FFDAB9",
              List.of(
                  "Takes the name of enemies", "slain nearby", "Defenceless 3s after each kill")));

  public static final KitSpec WRAITH =
      kit(
          new Card(
              "wraith",
              "Wraith",
              "A kit that is extremely similar to what Ghost is, however this kit functions"
                  + " differently!\n\nInferior to a normal ghost, wraith has no enderpearls or sword but"
                  + " instead must make do with a bow with power II!",
              200,
              KitTier.BASIC),
          gear(
              List.of(
                  ItemSpec.of("BOW").enchanted("infinity", 1).enchanted("power", 2),
                  ItemSpec.of("ARROW")),
              List.of(),
              Optional.of("wraith")),
          new KitSpec.Menu(
              "TIPPED_ARROW",
              List.of("Invisible like a Ghost", "Bow with Power II and Infinity", "No armour")));

  public static final KitSpec BLEEDER =
      kit(
          new Card(
              "bleeder",
              "Bleeder",
              "One of the most feared kits, the bleeder can permanently destroy the health of his foes"
                  + " with every blow",
              400,
              KitTier.ADVANCED),
          gear(
              List.of(ItemSpec.of("WOODEN_SWORD").named("The Bleeder", "dark_red")),
              fullSet("CHAINMAIL"),
              Optional.of("bleeder")),
          new KitSpec.Menu(
              "WOODEN_SWORD",
              List.of("Hits deal 2-3 damage", "and take that much max health", "Full chainmail")));

  public static final KitSpec EQUALITY =
      kit(
          new Card(
              "equality",
              "Equality",
              "You will always take 3 damage, you will always deal 3 damage. You were born equal and"
                  + " you will die equal.",
              350,
              KitTier.MID),
          gear(
              List.of(ItemSpec.of("IRON_SWORD")),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS).dyed(WHITE),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS).dyed(BLACK),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE).dyed(WHITE),
                  ItemSpec.armor("LEATHER_HELMET", ArmorSlot.HELMET).dyed(BLACK)),
              Optional.of("equality")),
          new KitSpec.Menu(
              "SMOOTH_STONE_SLAB",
              List.of("Every hit you deal or take is 3", "Iron sword", "Black and white leather")));

  public static final KitSpec INERTIA =
      kit(
          new Card(
              "inertia",
              "Inertia",
              "An unstoppable force that can be as much danger to itself as it is to others. Damage"
                  + " increases as you run, sharp turns negate this and running into a wall can be"
                  + " quite painful.",
              350,
              KitTier.MID),
          gear(
              List.of(ItemSpec.of("WOODEN_SWORD"), ItemSpec.of("SHIELD")),
              List.of(
                  ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS).enchanted("protection", 2),
                  ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS).enchanted("protection", 2),
                  ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE)
                      .enchanted("protection", 2),
                  ItemSpec.armor("IRON_HELMET", ArmorSlot.HELMET).enchanted("protection", 2)),
              Optional.of("inertia")),
          new KitSpec.Menu(
              "QUARTZ",
              List.of(
                  "Running builds up melee damage",
                  "Sharp turns lose it",
                  "Running into a wall hurts")));

  public static final KitSpec SACRIFICIAL =
      kit(
          new Card(
              "sacrificial",
              "Sacrificial",
              "This kit will lets the user sacrifice their health in place of one of their allies."
                  + " When being sacrificed for, the ally will transfer all damage taken to the"
                  + " sacrificial, who must consume their every replenishing steak to survive. Be"
                  + " cautious, for the"
                  + " sacrificial will take 5x more damage when directly attacked!",
              500,
              KitTier.ADVANCED),
          gear(
              List.of(
                  ItemSpec.of("WOODEN_SWORD").enchanted("knockback", 1),
                  ItemSpec.of("RED_DYE").named("Sacrificial Magic", "red"),
                  ItemSpec.of("COOKED_BEEF", 10),
                  // Two shears in one slot, as Red Warfare overstacked them: each snips once.
                  ItemSpec.of("SHEARS", 2).named("Destroy Sacrificial Bonds", "red")),
              fullSet("IRON"),
              Optional.of("sacrificial")),
          new KitSpec.Menu(
              "COOKED_BEEF",
              List.of(
                  "Bond allies: take their damage",
                  "Steaks come back every 20s",
                  "Direct hits on you hurt 4x")));

  public static final KitSpec SAPPER =
      kit(
          new Card(
              "sapper",
              "Sapper",
              "A bomb disposal expert. Its fuse defuses three seconds faster, and its training means"
                  + " explosions only do it half the harm they do to anyone else.",
              150,
              KitTier.BASIC),
          gear(
              Optional.of(new FuseBonus(FuseType.BOMB_DEFUSING, 3)),
              List.of(ItemSpec.of("IRON_SWORD")),
              fullSet("CHAINMAIL"),
              Optional.of("sapper")),
          new KitSpec.Menu(
              "SHEARS",
              List.of(
                  "Fuse with Bomb Defusing III",
                  "Half damage from explosions",
                  "Iron sword, full chainmail")));

  public static final KitSpec SABOTEUR =
      kit(
          new Card(
              "saboteur",
              "Saboteur",
              "A quiet bomber. Its fuse arms three seconds faster, and while its team arms a bomb the"
                  + " enemy cannot see how far along the fuse is until there are ten seconds left.",
              200,
              KitTier.BASIC),
          gear(
              Optional.of(new FuseBonus(FuseType.BOMB_ARMING, 3)),
              List.of(ItemSpec.of("STONE_SWORD")),
              List.of(
                  ItemSpec.armor("LEATHER_BOOTS", ArmorSlot.BOOTS).dyed(DARK),
                  ItemSpec.armor("LEATHER_LEGGINGS", ArmorSlot.LEGGINGS).dyed(DARK),
                  ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE).dyed(DARK),
                  ItemSpec.armor("LEATHER_HELMET", ArmorSlot.HELMET).dyed(DARK)),
              Optional.of("saboteur")),
          new KitSpec.Menu(
              "REDSTONE_TORCH",
              List.of(
                  "Fuse with Bomb Arming III",
                  "Hides your team's arming progress",
                  "until 10 seconds are left")));

  public static final KitSpec SPOTTER =
      kit(
          new Card(
              "spotter",
              "Spotter",
              "A scout who marks targets. Looking through its spyglass makes every enemy in sight"
                  + " within 60 blocks glow for its team for six seconds.",
              250,
              KitTier.MID),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD"),
                  ItemSpec.of("SPYGLASS")
                      .named("Spotter's Glass", "aqua")
                      .lore("green", "Use to mark enemies in sight for your team")),
              archerArmor(),
              Optional.of("spotter")),
          new KitSpec.Menu(
              "SPYGLASS",
              List.of(
                  "Spyglass marks enemies in sight",
                  "They glow for your team for 6s",
                  "30 second recharge")));

  public static final KitSpec GRAPPLER =
      kit(
          new Card(
              "grappler",
              "Grappler",
              "A climber with a grappling hook. Cast it and reel in to be pulled to the hook, then"
                  + " land without fall damage.",
              300,
              KitTier.MID),
          gear(
              List.of(
                  ItemSpec.of("STONE_SWORD"),
                  ItemSpec.of("FISHING_ROD")
                      .named("Grappling Hook", "gold")
                      .lore("green", "Cast, then reel in to be pulled to the hook")),
              List.of(
                  ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("CHAINMAIL_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("CHAINMAIL_HELMET", ArmorSlot.HELMET)),
              Optional.of("grappler")),
          new KitSpec.Menu(
              "FISHING_ROD",
              List.of(
                  "Hook pulls you to where it lands",
                  "No fall damage for 3s after",
                  "5 second recharge")));

  public static final KitSpec BANNERMAN =
      kit(
          new Card(
              "bannerman",
              "Bannerman",
              "A rallying point for its team. It plants a banner that gives nearby allies"
                  + " Regeneration until the enemy tears it down.",
              300,
              KitTier.MID),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD"),
                  ItemSpec.of("WHITE_BANNER")
                      .named("Rallying Banner", "gold")
                      .dyed(ItemLook.TEAM_DYE)
                      .lore("green", "Place to give allies within 6 blocks Regeneration")),
              List.of(
                  ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS),
                  ItemSpec.armor("IRON_LEGGINGS", ArmorSlot.LEGGINGS),
                  ItemSpec.armor("CHAINMAIL_CHESTPLATE", ArmorSlot.CHESTPLATE),
                  ItemSpec.armor("IRON_HELMET", ArmorSlot.HELMET)),
              Optional.of("bannerman")),
          new KitSpec.Menu(
              "WHITE_BANNER",
              List.of(
                  "Plant a banner: Regeneration I",
                  "for allies within 6 blocks",
                  "Enemies break it in 3 hits")));

  public static final KitSpec ENGINEER =
      kit(
          new Card(
              "engineer",
              "Engineer",
              "A builder of cover. It raises a short-lived barricade wherever it looks, though never"
                  + " right beside a bomb.",
              400,
              KitTier.ADVANCED),
          gear(
              List.of(
                  ItemSpec.of("STONE_SWORD"),
                  ItemSpec.of("BRICKS")
                      .named("Barricade", "gold")
                      .lore("green", "Right click a block to raise a 3x2 wall for 8 seconds")),
              fullSet("IRON"),
              Optional.of("engineer")),
          new KitSpec.Menu(
              "BRICKS",
              List.of(
                  "Raises a 3x2 wall for 8 seconds",
                  "Not within 4 blocks of a bomb",
                  "25 second recharge")));

  public static final KitSpec TRACKER =
      kit(
          new Card(
              "tracker",
              "Tracker",
              "A hunter that reads the ground. It sees the footprints enemies left in the last eight"
                  + " seconds, and its first hit on someone marks them on its team's compasses.",
              400,
              KitTier.ADVANCED),
          gear(
              List.of(ItemSpec.of("IRON_SWORD"), ItemSpec.of("CROSSBOW"), ItemSpec.of("ARROW", 32)),
              archerArmor(),
              Optional.of("tracker")),
          new KitSpec.Menu(
              "CROSSBOW",
              List.of(
                  "Sees enemy footprints",
                  "First hit marks the target",
                  "on your team's compasses")));

  public static final KitSpec DECOY =
      kit(
          new Card(
              "decoy",
              "Decoy",
              "A trickster. It sends a running copy of itself the way it looks and turns invisible"
                  + " while the enemy chases the copy.",
              450,
              KitTier.ADVANCED),
          gear(
              List.of(
                  ItemSpec.of("IRON_SWORD"),
                  ItemSpec.of("ARMOR_STAND")
                      .named("Decoy", "gold")
                      .lore("green", "Right click to send a running copy of you")),
              fullSet("IRON"),
              Optional.of("decoy")),
          new KitSpec.Menu(
              "ARMOR_STAND",
              List.of(
                  "Sends a running copy of you",
                  "You turn invisible for 3s",
                  "35 second recharge")));

  /** Every kit, in the kit menu's order. */
  public static final List<KitSpec> ALL =
      List.of(
          TROOPER,
          BERSERKER,
          DEMOLITIONS,
          DWARF,
          EXPLOSIVE,
          GHOST,
          JUGGERNAUT,
          LONGBOW,
          MEDIC,
          PYRO,
          REWIND,
          SHORTBOW,
          SPY,
          TELEPORTER,
          VAMPIRE,
          VENOM,
          WARPER,
          NINJA,
          FROST,
          SKINNER,
          WRAITH,
          BLEEDER,
          EQUALITY,
          INERTIA,
          SACRIFICIAL,
          SAPPER,
          SABOTEUR,
          SPOTTER,
          GRAPPLER,
          BANNERMAN,
          ENGINEER,
          TRACKER,
          DECOY);

  /**
   * The four kits The Storm first shipped, offered on their own while the expanded kit list is
   * switched off, and the kits the generated lobby has alcoves for.
   */
  public static final List<KitSpec> MILESTONE_ONE = List.of(TROOPER, LONGBOW, SHORTBOW, REWIND);

  /**
   * Kits the teams share out evenly before anyone else is placed, as Red Warfare's {@code
   * isBalancedTeams} kits were.
   */
  public static final Set<String> SPREAD_EVENLY = Set.of(MEDIC.id());

  /**
   * Kits an enemy spectator may not teleport to, as Red Warfare's {@code canTeleportTo} kept the
   * stealth kits hidden.
   */
  public static final Set<String> HIDDEN_FROM_SPECTATORS = Set.of(GHOST.id(), WRAITH.id());

  /** The kit a member fights with when they never picked one. */
  public static final KitSpec DEFAULT = TROOPER;

  private KitBook() {}

  public static Optional<KitSpec> byId(String id) {
    return ALL.stream().filter(kit -> kit.id().equals(id)).findFirst();
  }

  /**
   * A kit's identity and price.
   *
   * @param id the kit id
   * @param name its display name
   * @param description Red Warfare's description
   * @param price its price in credits
   * @param tier its tier
   */
  private record Card(String id, String name, String description, int price, KitTier tier) {}

  /**
   * What a kit carries.
   *
   * @param fuse its fuse bonus, if any
   * @param hotbar its hotbar
   * @param armor its armour
   * @param ability its ability id, if any
   */
  private record Gear(
      Optional<FuseBonus> fuse,
      List<ItemSpec> hotbar,
      List<ItemSpec> armor,
      Optional<String> ability) {}

  private static Gear gear(List<ItemSpec> hotbar, List<ItemSpec> armor, Optional<String> ability) {
    return new Gear(Optional.empty(), hotbar, armor, ability);
  }

  private static Gear gear(
      Optional<FuseBonus> fuse,
      List<ItemSpec> hotbar,
      List<ItemSpec> armor,
      Optional<String> ability) {
    return new Gear(fuse, hotbar, armor, ability);
  }

  private static KitSpec kit(Card card, Gear gear, KitSpec.Menu menu) {
    return new KitSpec(
        card.id(),
        card.name(),
        card.description(),
        card.price(),
        card.tier(),
        card.price() == 0 ? KitAvailability.FREE : KitAvailability.PURCHASE,
        gear.fuse(),
        gear.hotbar(),
        gear.armor(),
        gear.ability(),
        menu);
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

  /** Pyro's armour enchantments: Fire Protection I, Blast Protection II, Projectile I. */
  private static ItemSpec fireproof(ItemSpec piece) {
    return piece
        .enchanted("fire_protection", 1)
        .enchanted("blast_protection", 2)
        .enchanted("projectile_protection", 1);
  }
}

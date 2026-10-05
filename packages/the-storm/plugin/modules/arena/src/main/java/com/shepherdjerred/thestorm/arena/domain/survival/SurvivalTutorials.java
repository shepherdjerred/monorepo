package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey.Topic.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** The feature dependency catalog also powers the browsable survivor handbook. */
public final class SurvivalTutorials {
  private SurvivalTutorials() {}

  public static TutorialGraph catalog() {
    var tips = new ArrayList<TutorialGraph.Tip>();
    core(
        tips,
        ENTRY,
        "Welcome, survivor. Choose a class with your compass, gather supplies, and ready up with the iron block. /survival guide opens the handbook.");
    core(
        tips,
        CLASSES,
        "All six classes are shown in the class menu. Permanent XP unlocks later classes; debug practice unlocks every class.",
        ENTRY);
    core(
        tips,
        SPECIALIZATIONS,
        "After rounds 4, 9, and 14, sneak and use your compass to choose a specialization or class upgrade.",
        CLASSES);
    core(
        tips,
        COMBAT,
        "Fight together, use shields and your compass ability, and finish every enemy to clear a round. Enemies arrive gradually.",
        ENTRY);
    core(
        tips,
        GATHERING,
        "Bright glints mark usable gathering nodes. Right-click to harvest. Each material refills for you every round.",
        ENTRY);
    core(
        tips,
        CRAFTING,
        "Shop categories sit above a divider; recipes sit below. You can rearrange your inventory while shopping. Purchases use carried supplies, then team supplies.",
        GATHERING);
    core(
        tips,
        ENCHANTING,
        "Enchant held Common equipment to Uncommon, then Epic. Rarity is separate from material and Runeforge augmentation.",
        CRAFTING);
    core(
        tips,
        BANKING,
        "Deposit supplies into the team bank. Your private locker preserves exact gear. Shift-click inventory items to store; click locker items to withdraw.",
        GATHERING);
    core(
        tips,
        NODE_UPGRADES,
        "Sneak and right-click a node to improve team gathering yields. Open the next workshop district first; upgrades cost 8 then 16 emeralds.",
        GATHERING);
    core(
        tips,
        PICKUPS,
        "Floating field salvage helps the team. Read its effect before walking close to collect. First encounters give you two seconds to inspect it.",
        COMBAT);
    core(
        tips,
        ENCOUNTERS,
        "Encounter families introduce different enemies. Watch ranged attackers and protect gathering paths; crowd control is weaker against bosses.",
        COMBAT);
    core(
        tips,
        BOSS_MECHANICS,
        "Bosses cast at locked positions. Leave marked ground before the countdown ends, then attack during recovery. Blocks and terrain can protect you.",
        ENCOUNTERS);
    core(
        tips,
        REVIVAL,
        "Sneak within three blocks of a downed teammate and keep line of sight to revive. Solo runs start with an Echo Totem; buy extra charges at the infirmary.",
        COMBAT);
    core(
        tips,
        ROUTES,
        "Click a route sign twice within three seconds to pay its emerald cost. Open routes help everyone and activate new enemy entrances.",
        COMBAT);
    core(
        tips,
        DEFENSES,
        "Repair barricades with planks. Charge traps with iron and redstone. Defenses slow enemies and preserve room to gather.",
        ROUTES);
    core(
        tips,
        POWER,
        "The copper generator needs four iron and four redstone. Both blocks work. Power activates rune shrines, the runic cache, and the Runeforge.",
        ROUTES);
    core(
        tips,
        BOONS,
        "Equip two shrine boons. Buy a boon once per run, then swap owned boons free. Choose a replacement before paying; boons suspend while downed.",
        POWER);
    core(
        tips,
        BOX,
        "The active runic cache has a magenta beacon. Spend 16 emeralds, wait for the reveal, then claim your private reward before it expires.",
        POWER);
    core(
        tips,
        RARITY,
        "Common → Uncommon → Epic → Legendary → Mythic. The cache can roll every rarity. Legendary and Mythic gear adds bounded signature mechanics.",
        BOX);
    core(
        tips,
        EQUIPMENT_EFFECTS,
        "Read gear lore for its signature, fuel costs, and recharge. Cooldowns survive swapping equipment; bosses retain their defenses.",
        RARITY);
    core(
        tips,
        PLANE,
        "Install three plane parts and power the generator to reach the offshore Runeforge. Later trips need fuel. Boarding takes five seconds; rounds continue.",
        POWER);
    core(
        tips,
        AUGMENTATION,
        "Select a weapon, shield, or armor piece at the Runeforge. Augmentations I–III cost 12/24/36 emeralds and repair gear while preserving rarity and signature.",
        PLANE,
        ENCHANTING);
    for (var event : EncounterDirector.Event.values())
      child(tips, new TutorialKey(ENCOUNTER, event.name()), ENCOUNTERS, encounter(event));
    for (var boss :
        List.of(
            "gale-sovereign", "hexmaster", "ravager", "heartwood", "warden", "furnace-colossus"))
      child(tips, new TutorialKey(BOSS, boss), BOSS_MECHANICS, boss(boss));
    for (var shape : BossMechanics.Shape.values())
      child(
          tips,
          new TutorialKey(CAST, shape.name()),
          BOSS_MECHANICS,
          shape.label() + ": " + shape(shape));
    for (var boon : SurvivalPerk.values())
      child(
          tips,
          new TutorialKey(BOON, boon.name()),
          BOONS,
          boon.title() + ": " + boon.description());
    for (var drop : SurvivalDrop.values())
      child(
          tips,
          new TutorialKey(DROP, drop.name()),
          PICKUPS,
          drop.title() + ": " + drop.description());
    for (var gear : LegendaryWeapon.values())
      child(
          tips,
          new TutorialKey(EQUIPMENT, gear.name()),
          EQUIPMENT_EFFECTS,
          gear.name().replace('_', ' ') + ": " + equipment(gear));
    return new TutorialGraph(tips);
  }

  private static void core(
      List<TutorialGraph.Tip> tips,
      TutorialKey.Topic topic,
      String text,
      TutorialKey.Topic... parents) {
    tips.add(
        new TutorialGraph.Tip(
            TutorialKey.of(topic),
            text,
            java.util.Arrays.stream(parents)
                .map(TutorialKey::of)
                .collect(java.util.stream.Collectors.toUnmodifiableSet())));
  }

  private static void child(
      List<TutorialGraph.Tip> tips, TutorialKey key, TutorialKey.Topic parent, String text) {
    tips.add(new TutorialGraph.Tip(key, text, Set.of(TutorialKey.of(parent))));
  }

  private static String encounter(EncounterDirector.Event event) {
    return switch (event) {
      case HORDE -> "Horde: ordinary undead arrive through opened districts. Keep an escape route.";
      case ILLAGER_SIEGE ->
          "Illager siege: close distance on crossbows while avoiding charging attackers.";
      case OMINOUS_TRIAL -> "Ominous trial: watch wind projectiles and keep moving between cover.";
      case MOUNTED_ASSAULT ->
          "Mounted assault: riders and mounts create pressure from different directions.";
      case PALE_INCURSION ->
          "Pale incursion: investigate glowing objectives and keep your teammates nearby.";
      case NETHER_BREACH ->
          "Nether breach: fire and ranged pressure punish standing still. Use cover and healing.";
    };
  }

  private static String boss(String id) {
    return switch (id) {
      case "gale-sovereign" ->
          "Breeze Sovereign deflects ranged shots. Dodge wind lanes, then use melee during recovery.";
      case "hexmaster" ->
          "Evoker Commander: click the glowing ritual node while casting to interrupt and expose the boss.";
      case "ravager" ->
          "Ravager Siege Beast: move sideways from the locked charge lane; watch nearby barricades.";
      case "heartwood" ->
          "Creaking Guardian: strike its glowing heart three times to expose it. Ordinary attacks cannot bypass the heart.";
      case "warden" ->
          "Listening Warden: leave the narrow sonic lane and the marked rings; use its recovery window.";
      case "furnace-colossus" ->
          "Furnace Colossus: watch heated lanes, slag circles, and steam rings. Escape before the cast lands.";
      default -> throw new IllegalArgumentException("Unknown tutorial boss");
    };
  }

  private static String shape(BossMechanics.Shape shape) {
    return switch (shape) {
      case WIND_LANES, HEATED_FLOOR -> "move out of the three marked lanes.";
      case CHARGE, SONIC_ZONE -> "move sideways out of the narrow locked lane.";
      case FANG_CROSS, ENTANGLE -> "leave the marked cross; diagonals offer room.";
      case VORTEX, SONIC_RIPPLES, COOLANT, WARDED_ADDS, HEART_SHIFT ->
          "leave the marked ring; its center is clear.";
      case ROOTS, RITUAL, SILENCE, SLAG -> "leave the locked circle around the target.";
      case SLAM -> "move away from the boss before impact.";
      case WIND_BARRAGE, DEBRIS -> "leave the three locked impact circles.";
    };
  }

  private static String equipment(LegendaryWeapon gear) {
    return switch (gear) {
      case STORMCALLER -> "ranged hits arc to nearby enemies.";
      case FROSTBITE -> "hits slow ordinary enemies.";
      case WHIRLWIND -> "charged melee sweeps nearby enemies.";
      case TIDEBREAKER ->
          "returning trident hits arc to nearby enemies; its throw slot stays reserved.";
      case GRAVITON ->
          "right-click to spend redstone and pull ordinary enemies into a gravity well.";
      case RIFTBLADE -> "right-click to dash through safe space; terrain can block the dash.";
      case REPEATER -> "hold use to fire bursts; each bolt consumes an arrow.";
      case COPPERGUARD -> "blocking arcs 3 HP to two nearby foes; six-second recharge.";
      case BRIARPLATE ->
          "taking damage slows three nearby ordinary foes for two seconds; eight-second recharge.";
      case TRAILWARDEN -> "sprinting leaves a slowing trail; three-second recharge.";
      case STORMGLASS ->
          "three fully drawn hits charge your next storm shot; costs two redstone and has a ten-second recharge.";
      case WAYFARER ->
          "right-click to set a five-second anchor, then return with a damaging burst; costs two redstone, twenty-second recharge.";
      case ECHOHEART ->
          "stores up to 12 HP of actual damage; your next ability gives nearby allies up to 6 absorption HP.";
      case FAULTLINE ->
          "stores blocked damage; release your shield to erupt in a cone hitting at most six foes; twelve-second recharge.";
    };
  }
}

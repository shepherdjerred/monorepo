package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.Tag;

/**
 * What each block type means for protection: its subject, what right-clicking it does, what
 * stepping on it or hitting it with a projectile does, and which held items change the block they
 * are used on. Built once from vanilla tags when the module enables.
 */
final class BlockKinds {

  private static final List<Material> CONTAINERS =
      List.of(
          Material.CHEST,
          Material.TRAPPED_CHEST,
          Material.BARREL,
          Material.FURNACE,
          Material.BLAST_FURNACE,
          Material.SMOKER,
          Material.HOPPER,
          Material.DROPPER,
          Material.DISPENSER,
          Material.BREWING_STAND,
          Material.CRAFTER,
          Material.JUKEBOX,
          Material.CHISELED_BOOKSHELF,
          Material.DECORATED_POT,
          Material.COMPOSTER,
          Material.BEACON,
          Material.VAULT);

  private static final List<Material> REDSTONE =
      List.of(
          Material.REPEATER,
          Material.COMPARATOR,
          Material.DAYLIGHT_DETECTOR,
          Material.NOTE_BLOCK,
          Material.REDSTONE_WIRE);

  /** Components and power sources beyond buttons, plates and lightning rods (tags). */
  private static final List<Material> REDSTONE_SOURCES =
      List.of(
          Material.REDSTONE_WIRE,
          Material.LEVER,
          Material.REDSTONE_TORCH,
          Material.REDSTONE_WALL_TORCH,
          Material.REDSTONE_BLOCK,
          Material.REPEATER,
          Material.COMPARATOR,
          Material.OBSERVER,
          Material.TARGET,
          Material.DAYLIGHT_DETECTOR,
          Material.DETECTOR_RAIL,
          Material.ACTIVATOR_RAIL,
          Material.TRAPPED_CHEST,
          Material.TRIPWIRE_HOOK,
          Material.TRIPWIRE,
          Material.LECTERN,
          Material.SCULK_SENSOR,
          Material.CALIBRATED_SCULK_SENSOR,
          Material.JUKEBOX);

  private static final Set<Material> BLOCK_CHANGING_ITEMS =
      Set.of(
          Material.HONEYCOMB,
          Material.BRUSH,
          Material.BONE_MEAL,
          Material.INK_SAC,
          Material.GLOW_INK_SAC,
          Material.GLASS_BOTTLE,
          Material.POTION,
          Material.SHEARS,
          Material.ENDER_EYE,
          Material.FLINT_AND_STEEL,
          Material.FIRE_CHARGE);

  private final Map<Material, Subject> subjects = new EnumMap<>(Material.class);
  private final Map<Material, Act> uses = new EnumMap<>(Material.class);
  private final Map<Material, Act> steps = new EnumMap<>(Material.class);
  private final Map<Material, Act> impacts = new EnumMap<>(Material.class);
  private final Map<Material, Act> presses = new EnumMap<>(Material.class);
  private final Set<Material> redstone = EnumSet.noneOf(Material.class);

  BlockKinds() {
    switches();
    containers();
    others();
    stepsAndImpacts();
    redstone();
  }

  private void switches() {
    use(Tag.DOORS.getValues(), Action.INTERACT, Subject.DOOR);
    use(Tag.TRAPDOORS.getValues(), Action.INTERACT, Subject.TRAPDOOR);
    use(Tag.FENCE_GATES.getValues(), Action.INTERACT, Subject.FENCE_GATE);
    use(Tag.BUTTONS.getValues(), Action.INTERACT, Subject.BUTTON);
    use(Set.of(Material.LEVER), Action.INTERACT, Subject.LEVER);
    use(Set.of(Material.BELL), Action.INTERACT, Subject.BELL);
    use(Tag.BEDS.getValues(), Action.INTERACT, Subject.BED);
    use(Set.of(Material.RESPAWN_ANCHOR), Action.INTERACT, Subject.RESPAWN_ANCHOR);
    use(Tag.ANVIL.getValues(), Action.INTERACT, Subject.ANVIL);
    use(Tag.CANDLES.getValues(), Action.INTERACT, Subject.BLOCK);
    use(Tag.COPPER_GOLEM_STATUES.getValues(), Action.INTERACT, Subject.BLOCK);
    use(REDSTONE, Action.USE_REDSTONE, Subject.REDSTONE_COMPONENT);
  }

  private void containers() {
    use(CONTAINERS, Action.OPEN_CONTAINER, Subject.CONTAINER);
    use(Tag.SHULKER_BOXES.getValues(), Action.OPEN_CONTAINER, Subject.CONTAINER);
    use(Tag.COPPER_CHESTS.getValues(), Action.OPEN_CONTAINER, Subject.CONTAINER);
    use(Tag.WOODEN_SHELVES.getValues(), Action.OPEN_CONTAINER, Subject.CONTAINER);
    use(Tag.CAMPFIRES.getValues(), Action.OPEN_CONTAINER, Subject.CONTAINER);
  }

  private void others() {
    use(Set.of(Material.CAKE), Action.BREAK, Subject.CAKE);
    use(Tag.CANDLE_CAKES.getValues(), Action.BREAK, Subject.CAKE);
    use(Tag.FLOWER_POTS.getValues(), Action.BUILD, Subject.BLOCK);
    use(Set.of(Material.DRAGON_EGG), Action.BREAK, Subject.BLOCK);
    use(
        Set.of(Material.SWEET_BERRY_BUSH, Material.CAVE_VINES, Material.CAVE_VINES_PLANT),
        Action.BREAK,
        Subject.BLOCK);
    subject(Tag.ALL_SIGNS.getValues(), Subject.SIGN);
    subject(Set.of(Material.LECTERN), Subject.LECTERN);
    subject(Set.of(Material.FARMLAND), Subject.FARMLAND);
    subject(Tag.PRESSURE_PLATES.getValues(), Subject.PRESSURE_PLATE);
    subject(Set.of(Material.TRIPWIRE, Material.TRIPWIRE_HOOK), Subject.TRIPWIRE);
  }

  private void stepsAndImpacts() {
    steps.put(Material.FARMLAND, new Act(Action.BREAK, Subject.FARMLAND));
    steps.put(Material.TURTLE_EGG, new Act(Action.BREAK, Subject.BLOCK));
    steps.put(Material.TRIPWIRE, new Act(Action.INTERACT, Subject.TRIPWIRE));
    for (var plate : Tag.PRESSURE_PLATES.getValues()) {
      steps.put(plate, new Act(Action.INTERACT, Subject.PRESSURE_PLATE));
    }
    presses.putAll(steps);
    for (var button : Tag.BUTTONS.getValues()) {
      presses.put(button, new Act(Action.INTERACT, Subject.BUTTON));
    }
    impacts.put(Material.TARGET, new Act(Action.USE_REDSTONE, Subject.REDSTONE_COMPONENT));
    impacts.put(Material.BELL, new Act(Action.INTERACT, Subject.BELL));
    for (var fragile :
        List.of(Material.DECORATED_POT, Material.CHORUS_FLOWER, Material.POINTED_DRIPSTONE)) {
      impacts.put(fragile, new Act(Action.BREAK, Subject.BLOCK));
    }
    for (var tag : List.of(Tag.CAMPFIRES, Tag.CANDLES, Tag.CANDLE_CAKES)) {
      for (var lightable : tag.getValues()) {
        impacts.put(lightable, new Act(Action.BUILD, Subject.BLOCK));
      }
    }
  }

  private void redstone() {
    redstone.addAll(REDSTONE_SOURCES);
    for (var tag : List.of(Tag.BUTTONS, Tag.PRESSURE_PLATES, Tag.LIGHTNING_RODS)) {
      redstone.addAll(tag.getValues());
    }
  }

  private void use(Iterable<Material> materials, Action action, Subject subject) {
    for (var material : materials) {
      uses.put(material, new Act(action, subject));
      subjects.put(material, subject);
    }
  }

  private void subject(Iterable<Material> materials, Subject subject) {
    for (var material : materials) {
      subjects.put(material, subject);
    }
  }

  /** True for blocks redstone opens: doors, trapdoors and fence gates. */
  boolean opensWithRedstone(Material type) {
    var subject = subjects.get(type);
    return subject == Subject.DOOR || subject == Subject.TRAPDOOR || subject == Subject.FENCE_GATE;
  }

  /** The subject of placing or breaking a block of {@code type}. */
  Subject subject(Material type) {
    return subjects.getOrDefault(type, Subject.BLOCK);
  }

  /** What right-clicking a block of {@code type} does, or empty when anyone may use it. */
  Optional<Act> use(Material type) {
    return Optional.ofNullable(uses.get(type));
  }

  /** What stepping on a block of {@code type} does, or empty when stepping is harmless. */
  Optional<Act> step(Material type) {
    return Optional.ofNullable(steps.get(type));
  }

  /**
   * What an entity (an arrow, a thrown item, a mob, a mount) pressing or trampling a block of
   * {@code type} does, or empty when that is harmless.
   */
  Optional<Act> press(Material type) {
    return Optional.ofNullable(presses.get(type));
  }

  /** True for redstone components and power sources, which may not be wired into others' land. */
  boolean isRedstone(Material type) {
    return redstone.contains(type);
  }

  /** What a player's projectile does to a block of {@code type}, or empty when nothing. */
  Optional<Act> impact(Material type) {
    return Optional.ofNullable(impacts.get(type));
  }

  /**
   * True when using {@code item} on a block changes it: axes strip and scrape, shovels make paths,
   * hoes till, honeycomb waxes, brushes dig, dyes and ink change signs, eggs change spawners,
   * bottles take honey and make mud, eyes fill portal frames.
   */
  boolean changesBlocks(Material item) {
    if (BLOCK_CHANGING_ITEMS.contains(item)) {
      return true;
    }
    var name = item.name();
    return name.endsWith("_AXE")
        || name.endsWith("_SHOVEL")
        || name.endsWith("_HOE")
        || name.endsWith("_SPAWN_EGG")
        || name.endsWith("_DYE");
  }
}

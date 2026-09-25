package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.function.Predicate;
import org.bukkit.Material;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Lightable;
import org.bukkit.block.data.MultipleFacing;
import org.bukkit.block.data.Segmentable;
import org.bukkit.block.data.type.Bed;
import org.bukkit.block.data.type.Candle;
import org.bukkit.block.data.type.Fence;
import org.bukkit.block.data.type.FlowerBed;
import org.bukkit.block.data.type.SeaPickle;
import org.bukkit.block.data.type.Slab;
import org.bukkit.block.data.type.Snow;
import org.bukkit.block.data.type.TurtleEgg;

/**
 * Checks that every material {@code mechanics.yml} names exists on this server and is the right
 * kind of thing. A typo stops the module rather than silently matching nothing.
 *
 * <p>Bridges, doors and gates count one stored item per block, so their materials must be whole,
 * solid blocks that are always exactly one item: slabs (a double slab is two), candles, sea
 * pickles, turtle eggs, snow layers, flower beds, two-block doors and beds are refused.
 */
final class Materials {

  private record Kind(String name, Predicate<Material> test) {}

  private static final Kind BLOCK = new Kind("a block", Material::isBlock);
  private static final Kind ITEM = new Kind("an item", Material::isItem);
  private static final Kind LIGHT =
      new Kind(
          "a block with an on/off state",
          material -> material.isBlock() && material.createBlockData() instanceof Lightable);
  private static final Kind STRUCTURE =
      new Kind(
          "a solid block that is always exactly one item",
          material ->
              material.isBlock()
                  && material.isItem()
                  && material.isSolid()
                  && isSingleItem(material.createBlockData()));

  private Materials() {}

  static void verify(MechanicsConfig config) {
    var problems = problems(config);
    if (!problems.isEmpty()) {
      throw new IllegalStateException("Invalid mechanics.yml:\n" + String.join("\n", problems));
    }
  }

  /** Everything wrong with the materials {@code config} names. */
  static List<String> problems(MechanicsConfig config) {
    var problems = new ArrayList<String>();
    check("bridge.blocks", config.bridge().blocks(), STRUCTURE, problems);
    check("door.blocks", config.door().blocks(), STRUCTURE, problems);
    check("gate.blocks", config.gate().blocks(), STRUCTURE, problems);
    check("cookingPot.heatSources", config.cookingPot().heatSources(), BLOCK, problems);
    check("blockDrops.blocks", config.blockDrops().blocks(), BLOCK, problems);
    check("pistons.blacklist", config.pistons().blacklist(), BLOCK, problems);
    check("lightSwitch.lights", config.lightSwitch().lights(), LIGHT, problems);
    check("cookingPot.fuels", config.cookingPot().fuels().keySet(), ITEM, problems);
    check("signCopier.tool", List.of(config.signCopier().tool()), ITEM, problems);
    return problems;
  }

  /**
   * Whether every state of this block is one item when broken: no layers, counts, halves or several
   * faces.
   */
  static boolean isSingleItem(BlockData data) {
    return !(data instanceof Slab
        || data instanceof Candle
        || data instanceof SeaPickle
        || data instanceof TurtleEgg
        || data instanceof Snow
        || data instanceof FlowerBed
        || data instanceof Segmentable
        || data instanceof Bisected
        || data instanceof Bed
        || (data instanceof MultipleFacing && !(data instanceof Fence)));
  }

  private static void check(
      String path, Collection<String> keys, Kind kind, List<String> problems) {
    for (var key : keys) {
      var material = Material.matchMaterial(key);
      if (material == null || !PaperGrid.key(material).equals(key)) {
        problems.add(path + ": " + key + " is not a known material");
      } else if (!kind.test().test(material)) {
        problems.add(path + ": " + key + " is not " + kind.name());
      }
    }
  }
}

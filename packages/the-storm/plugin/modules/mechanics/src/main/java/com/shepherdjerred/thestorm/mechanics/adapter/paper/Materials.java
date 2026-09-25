package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.function.Predicate;
import org.bukkit.Material;
import org.bukkit.block.data.Lightable;

/**
 * Checks that every material {@code mechanics.yml} names exists on this server and is the right
 * kind of thing. A typo stops the module rather than silently matching nothing.
 */
final class Materials {

  private record Kind(String name, Predicate<Material> test) {}

  private static final Kind BLOCK = new Kind("a block", Material::isBlock);
  private static final Kind ITEM = new Kind("an item", Material::isItem);
  private static final Kind LIGHT =
      new Kind(
          "a block with an on/off state",
          material -> material.isBlock() && material.createBlockData() instanceof Lightable);

  private Materials() {}

  static void verify(MechanicsConfig config) {
    var problems = new ArrayList<String>();
    check("bridge.blocks", config.bridge().blocks(), BLOCK, problems);
    check("door.blocks", config.door().blocks(), BLOCK, problems);
    check("gate.blocks", config.gate().blocks(), BLOCK, problems);
    check("cookingPot.heatSources", config.cookingPot().heatSources(), BLOCK, problems);
    check("blockDrops.blocks", config.blockDrops().blocks(), BLOCK, problems);
    check("pistons.blacklist", config.pistons().blacklist(), BLOCK, problems);
    check("lightSwitch.lights", config.lightSwitch().lights(), LIGHT, problems);
    check("cookingPot.fuels", config.cookingPot().fuels().keySet(), ITEM, problems);
    check("signCopier.tool", List.of(config.signCopier().tool()), ITEM, problems);
    if (!problems.isEmpty()) {
      throw new IllegalStateException("Invalid mechanics.yml:\n" + String.join("\n", problems));
    }
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

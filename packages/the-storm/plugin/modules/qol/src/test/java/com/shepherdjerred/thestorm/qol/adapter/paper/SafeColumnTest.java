package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.junit.jupiter.api.Test;

final class SafeColumnTest {

  @Test
  void surfaceStandsAboveTheHighestSolidBlock() {
    var world = world(70, Map.of(69, Material.STONE, 70, Material.GRASS_BLOCK));

    assertThat(SafeColumn.surface(world, 0, 0)).contains(71);
  }

  @Test
  void hazardousSurfaceDoesNotRevealACaveUnderneath() {
    var blocks = new HashMap<Integer, Material>();
    blocks.put(59, Material.STONE);
    blocks.put(60, Material.STONE);
    blocks.put(70, Material.LAVA);
    var world = world(70, blocks);

    assertThat(SafeColumn.surface(world, 0, 0)).isEmpty();
    assertThat(SafeColumn.below(world, 0, 70, 0)).contains(61);
  }

  private static World world(int highest, Map<Integer, Material> blocks) {
    return (World)
        Proxy.newProxyInstance(
            World.class.getClassLoader(),
            new Class<?>[] {World.class},
            (proxy, method, args) ->
                switch (method.getName()) {
                  case "getHighestBlockYAt" -> highest;
                  case "getMinHeight" -> 0;
                  case "getBlockAt" -> block(blocks.getOrDefault((Integer) args[1], Material.AIR));
                  default -> throw new AssertionError("Unexpected world call: " + method.getName());
                });
  }

  private static Block block(Material material) {
    return (Block)
        Proxy.newProxyInstance(
            Block.class.getClassLoader(),
            new Class<?>[] {Block.class},
            (proxy, method, args) ->
                switch (method.getName()) {
                  case "getType" -> material;
                  case "isSolid" -> material.isSolid();
                  case "isLiquid" -> material == Material.WATER || material == Material.LAVA;
                  case "isPassable" -> !material.isSolid();
                  default -> throw new AssertionError("Unexpected block call: " + method.getName());
                });
  }
}

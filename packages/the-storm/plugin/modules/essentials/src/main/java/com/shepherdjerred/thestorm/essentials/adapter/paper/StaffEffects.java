package com.shepherdjerred.thestorm.essentials.adapter.paper;

import java.util.List;
import org.bukkit.Color;
import org.bukkit.FireworkEffect;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.TreeType;
import org.bukkit.entity.Bee;
import org.bukkit.entity.Cat;
import org.bukkit.entity.Fireball;
import org.bukkit.entity.Firework;
import org.bukkit.entity.TNTPrimed;

/** Explicit, bounded novelty and terrain commands. Destructive actions require confirmation. */
final class StaffEffects {
  private final StaffCommands tools;

  StaffEffects(StaffCommands tools) {
    this.tools = tools;
  }

  void register() {
    for (var name : List.of("tree", "bigtree"))
      tools.add(
          name,
          request -> {
            var location = target(request);
            tools.build(request, location);
            request.say(
                "Tree generated: "
                    + location
                        .getWorld()
                        .generateTree(
                            location,
                            java.util.Random.from(tools.context.random()),
                            "tree".equals(name) ? TreeType.TREE : TreeType.BIG_TREE,
                            (java.util.function.Predicate<org.bukkit.block.BlockState>)
                                state -> {
                                  try {
                                    tools.build(request, state.getLocation());
                                    return true;
                                  } catch (IllegalArgumentException denied) {
                                    return false;
                                  }
                                }));
          });
    tools.add(
        "break",
        request -> {
          var location = target(request);
          tools.build(request, location);
          location.getBlock().breakNaturally();
          request.say("Block broken.");
        });
    tools.add(
        "burn <player> [seconds]",
        request -> {
          var player = tools.player(request.actor(), request.word(0));
          request.others(player);
          player.setFireTicks(request.words().length > 1 ? request.number(1, 1, 60) * 20 : 100);
          request.say("Fire applied.");
        });
    tools.add(
        "ext [player]",
        request -> {
          var player = request.target(0);
          request.others(player);
          player.setFireTicks(0);
          request.say("Extinguished " + player.getName() + ".");
        });
    tools.add(
        "ice",
        request -> {
          var location = target(request);
          tools.build(request, location);
          if (location.getBlock().getType() != Material.WATER)
            throw new IllegalArgumentException("Look at water.");
          location.getBlock().setType(Material.ICE);
          request.say("Water frozen.");
        });
    tools.add(
        "lightning",
        request -> {
          var location = target(request);
          tools.build(request, location);
          location.getWorld().strikeLightning(location);
        });
    tools.add(
        "fireball",
        request -> {
          var player = request.self();
          tools.build(request, target(request));
          var ball = player.launchProjectile(Fireball.class);
          ball.setYield(1);
          ball.setIsIncendiary(false);
        });
    tools.add("firework", this::firework);
    tools.add(
        "antioch",
        request -> {
          var location = target(request).add(0, 1, 0);
          tools.build(request, location);
          location
              .getWorld()
              .spawn(
                  location,
                  TNTPrimed.class,
                  tnt -> {
                    tnt.setFuseTicks(40);
                    tnt.setSource(request.self());
                    tnt.setYield(2);
                  });
        });
    tools.add("nuke", this::nuke);
    tools.add(
        "beezooka",
        request -> {
          var location = Positions.current(request.self()).add(0, 1, 0);
          tools.build(request, target(request));
          var bee = location.getWorld().spawn(location, Bee.class);
          bee.setVelocity(location.getDirection().multiply(2));
        });
    tools.add(
        "kittycannon",
        request -> {
          var location = Positions.current(request.self()).add(0, 1, 0);
          tools.build(request, target(request));
          var cat = location.getWorld().spawn(location, Cat.class);
          cat.setVelocity(location.getDirection().multiply(2));
        });
  }

  private void nuke(StaffCommands.Request request) {
    var center = target(request);
    var positions = new java.util.ArrayList<Location>();
    for (int x = -1; x <= 1; x++)
      for (int z = -1; z <= 1; z++) {
        var point = center.clone().add(x * 3, 4, z * 3);
        tools.build(request, point);
        positions.add(point);
      }
    positions.forEach(
        point ->
            point
                .getWorld()
                .spawn(
                    point,
                    TNTPrimed.class,
                    tnt -> {
                      tnt.setSource(request.self());
                      tnt.setYield(2);
                      tnt.setFuseTicks(40);
                    }));
    request.say("Nine bounded charges spawned.");
  }

  private void firework(StaffCommands.Request request) {
    var location = Positions.current(request.self());
    tools.build(request, location);
    var firework = location.getWorld().spawn(location, Firework.class);
    var meta = firework.getFireworkMeta();
    meta.addEffect(
        FireworkEffect.builder()
            .withColor(Color.fromRGB(tools.context.random().nextInt(0x1000000)))
            .with(FireworkEffect.Type.BALL)
            .build());
    meta.setPower(1);
    firework.setFireworkMeta(meta);
  }

  private Location target(StaffCommands.Request request) {
    var block =
        request
            .self()
            .getTargetBlockExact(
                tools.settings.effectRadius(), org.bukkit.FluidCollisionMode.ALWAYS);
    if (block == null)
      throw new IllegalArgumentException(
          "Look at a block within " + tools.settings.effectRadius() + " blocks.");
    return block.getLocation();
  }
}

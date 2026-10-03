package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.Settlement;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import java.util.List;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/** Only authored gates and defenses change during a run. Permanent buildings stay protected. */
final class SettlementMap {
  private final ArenaWorld world;
  private final SurvivalContent content;
  private final Settlement state;
  private final java.util.Map<String, java.util.UUID> trapOwners = new java.util.HashMap<>();

  SettlementMap(ArenaWorld world, SurvivalContent content) {
    this.world = world;
    this.content = content;
    state = new Settlement(content);
  }

  SurvivalContent content() {
    return content;
  }

  Settlement state() {
    return state;
  }

  List<SurvivalContent.Zone> open() {
    return content.zones().stream().filter(z -> state.accessible(z.id())).toList();
  }

  Optional<SurvivalContent.Zone> zone(Player player) {
    var point = Places.point(Places.at(player));
    return content.zones().stream().filter(z -> z.bounds().contains(point)).findFirst();
  }

  void contain(Player player) {
    if (!world.contains(Places.at(player))
        || zone(player).filter(z -> !state.accessible(z.id())).isPresent()) {
      player.teleport(Places.location(world.world(), world.definition().playerSpawns().getFirst()));
    }
  }

  void reset() {
    state.reset();
    trapOwners.clear();
    labels();
    content
        .zones()
        .forEach(
            zone -> {
              zone.gate()
                  .forEach(
                      block ->
                          world
                              .block(block)
                              .setType(
                                  state.accessible(zone.id()) ? Material.AIR : Material.IRON_BARS,
                                  false));
              zone.defenses()
                  .forEach(
                      defense -> {
                        if (defense.type() == SurvivalContent.DefenseType.BARRICADE) {
                          barricade(defense, Material.OAK_FENCE);
                        } else {
                          world
                              .block(defense.block())
                              .setType(Material.STONE_PRESSURE_PLATE, false);
                        }
                      });
            });
  }

  private void labels() {
    content.arena().classSigns().forEach((id, block) -> label(block, id, "Select class"));
    for (var zone : content.zones()) {
      var floor = content.arena().playerSpawns().getFirst().point().block().y();
      label(
          new BlockPos(zone.bounds().min().x() + 20, floor, zone.bounds().min().z() + 5),
          zone.name(),
          "Settlement district");
    }
  }

  private void label(BlockPos block, String title, String hint) {
    if (!(world.block(block).getState() instanceof org.bukkit.block.Sign sign)) {
      throw new IllegalStateException("Authored sign is missing at " + block);
    }
    var side = sign.getSide(org.bukkit.block.sign.Side.FRONT);
    side.line(0, net.kyori.adventure.text.Component.text(title));
    side.line(1, net.kyori.adventure.text.Component.text(hint));
    sign.setWaxed(true);
    sign.update(true, false);
  }

  void unlock(SurvivalContent.Zone zone) {
    state.unlock(zone);
    zone.gate().forEach(block -> world.block(block).setType(Material.AIR, false));
  }

  Optional<SurvivalContent.Zone> gate(BlockPos pos) {
    return content.zones().stream().filter(z -> z.gate().contains(pos)).findFirst();
  }

  Optional<SurvivalContent.Station> station(BlockPos pos) {
    return open().stream()
        .flatMap(z -> z.stations().stream())
        .filter(s -> s.block().equals(pos))
        .findFirst();
  }

  Optional<SurvivalContent.Resource> resource(BlockPos pos) {
    return open().stream()
        .flatMap(z -> z.resources().stream())
        .filter(r -> r.block().equals(pos))
        .findFirst();
  }

  Optional<SurvivalContent.Defense> defense(BlockPos pos) {
    return open().stream()
        .flatMap(z -> z.defenses().stream())
        .filter(d -> d.block().equals(pos))
        .findFirst();
  }

  BlockPos objective() {
    return open().stream()
        .flatMap(z -> z.resources().stream())
        .map(SurvivalContent.Resource::block)
        .findFirst()
        .orElseThrow(() -> new IllegalStateException("An open zone needs a boss objective"));
  }

  void arm(SurvivalContent.Defense defense, java.util.UUID player) {
    state.arm(defense.id());
    trapOwners.put(defense.id(), player);
  }

  void charge(org.bukkit.Location at) {
    open().stream()
        .flatMap(z -> z.defenses().stream())
        .filter(d -> d.type() == SurvivalContent.DefenseType.BARRICADE)
        .filter(d -> Places.location(world.world(), d.block().center()).distanceSquared(at) < 25)
        .forEach(
            d -> {
              while (state.strength(d.id()) > 0) {
                state.breach(d.id());
              }
              barricade(d, Material.AIR);
            });
  }

  void tick(java.util.function.BiConsumer<org.bukkit.entity.LivingEntity, java.util.UUID> credit) {
    for (var zone : open()) {
      zone.defenses().forEach(defense -> tickDefense(defense, credit));
    }
  }

  private void tickDefense(
      SurvivalContent.Defense defense,
      java.util.function.BiConsumer<org.bukkit.entity.LivingEntity, java.util.UUID> credit) {
    if (state.strength(defense.id()) == 0) {
      return;
    }
    var at = Places.location(world.world(), defense.block().center());
    var enemies =
        world.enemies().stream().filter(e -> e.getLocation().distanceSquared(at) < 9).toList();
    if (enemies.isEmpty()) {
      return;
    }
    if (defense.type() == SurvivalContent.DefenseType.BARRICADE) {
      if (state.breach(defense.id())) {
        barricade(defense, Material.AIR);
      }
    } else {
      state.breach(defense.id());
      var owner =
          java.util.Objects.requireNonNull(
              trapOwners.remove(defense.id()), "Charged trap has no owner");
      enemies.forEach(
          enemy -> {
            credit.accept(enemy, owner);
            enemy.damage(12);
            if (defense.type() == SurvivalContent.DefenseType.FLAME_TRAP) {
              enemy.setFireTicks(80);
            }
          });
      world.world().playSound(at, org.bukkit.Sound.BLOCK_ANVIL_LAND, 0.5f, 1.5f);
    }
  }

  void barricade(SurvivalContent.Defense defense, Material material) {
    for (var dx = -1; dx <= 1; dx++) {
      var block = defense.block();
      world.block(new BlockPos(block.x() + dx, block.y(), block.z())).setType(material, false);
    }
  }
}

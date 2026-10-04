package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import java.time.Instant;
import org.bukkit.Particle;
import org.bukkit.entity.Player;

/** Nearby personal glints and a single look-at prompt keep the environment readable. */
final class SurvivalPresentation {
  private final SurvivalRunner runner;
  private Instant next = Instant.MIN;

  SurvivalPresentation(SurvivalRunner runner) {
    this.runner = runner;
  }

  void tick() {
    var now = runner.context().time().instant();
    if (now.isBefore(next)) return;
    next = now.plusSeconds(1);
    for (var player : runner.fighters()) {
      for (var zone : runner.map().open()) {
        for (var resource : zone.resources()) {
          if (runner.map().state().available(player.getUniqueId(), resource))
            particle(player, resource.block(), Particle.HAPPY_VILLAGER);
        }
        for (var station : zone.stations()) particle(player, station.block(), Particle.ENCHANT);
      }
      hint(player);
    }
  }

  private static void particle(Player player, BlockPos pos, Particle particle) {
    var at = Places.location(player.getWorld(), pos.center()).add(0, .7, 0);
    if (at.distanceSquared(Places.at(player)) <= 36)
      player.spawnParticle(particle, at, 1, .2, .15, .2, 0);
  }

  private void hint(Player player) {
    var block = player.getTargetBlockExact(4);
    if (block == null) return;
    var pos = Places.pos(block);
    var resource = runner.map().resource(pos);
    if (resource.isPresent()) {
      var node = resource.orElseThrow();
      runner.hud().context(player, resourceHint(player, node));
      return;
    }
    var station = runner.map().station(pos);
    if (station.isPresent()) {
      runner.hud().context(player, stationName(station.orElseThrow().type()) + " · right-click");
      return;
    }
    var route = runner.map().gate(pos).filter(runner.map().state()::unlockable);
    if (route.isPresent()) {
      runner
          .hud()
          .context(
              player,
              route.orElseThrow().name()
                  + " · "
                  + route.orElseThrow().emeralds()
                  + " emeralds · click twice");
      return;
    }
    var site =
        runner.map().content().boxSites().stream()
            .filter(s -> s.block().equals(pos))
            .filter(s -> s.id().equals(runner.machines().box().active()))
            .findFirst();
    if (site.isPresent()) {
      runner
          .hud()
          .context(
              player,
              runner.machines().powered()
                  ? runner.machines().box().status(site.orElseThrow())
                  : "Mystery box · needs power");
      return;
    }
    runner
        .map()
        .machine(pos)
        .filter(m -> m.type() != SurvivalContent.MachineType.MYSTERY_BOX)
        .ifPresent(m -> runner.hud().context(player, machineHint(player, m.type())));
  }

  private String resourceHint(Player player, SurvivalContent.Resource node) {
    if (!runner.map().state().available(player.getUniqueId(), node)) return "Refills next round";
    var action = player.isSneaking() ? "right-click for upgrades" : "right-click";
    return "Gather " + SurvivalItems.name(SurvivalItems.material(node.material())) + " · " + action;
  }

  static String stationName(SurvivalContent.StationType type) {
    return switch (type) {
      case WORKBENCH -> "Workbench";
      case FORGE -> "Forge";
      case INFIRMARY -> "Food and healing";
      case ALCHEMY -> "Alchemy";
      case BANK -> "Bank · team supplies and private locker";
    };
  }

  static String machineName(SurvivalContent.MachineType type) {
    return switch (type) {
      case FOOD -> "Food counter";
      case POWER -> "Power generator";
      case MYSTERY_BOX -> "Mystery box";
      case PACK_A_PUNCH -> "Pack-a-Punch";
      case JUGGERNOG -> "Juggernog";
      case STAMIN_UP -> "Stamin-Up";
      case DOUBLE_TAP -> "Double Tap";
      case QUICK_REVIVE -> "Quick Revive";
    };
  }

  private String machineHint(Player player, SurvivalContent.MachineType type) {
    var name = machineName(type);
    if (type == SurvivalContent.MachineType.POWER)
      return runner.machines().powered() ? "Power on" : name + " · 4 iron + 4 redstone";
    if (type != SurvivalContent.MachineType.FOOD
        && type != SurvivalContent.MachineType.QUICK_REVIVE
        && !runner.machines().powered()) return name + " · needs power";
    return name
        + " · "
        + switch (type) {
          case FOOD -> "3 bread for 2 emeralds";
          case PACK_A_PUNCH -> {
            var weapon = player.getInventory().getItemInMainHand();
            var tier = runner.items().tier(weapon);
            yield !runner.items().weapon(weapon)
                ? "hold a weapon"
                : tier == 3 ? "fully upgraded" : 12 * (tier + 1) + " emeralds";
          }
          case JUGGERNOG, STAMIN_UP, DOUBLE_TAP, QUICK_REVIVE -> {
            var perk =
                com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk.valueOf(type.name());
            yield runner.actions().has(player, perk) ? "owned" : perk.price() + " emeralds";
          }
          case MYSTERY_BOX, POWER -> throw new IllegalStateException("Already handled machine");
        };
  }

  void reset() {
    next = Instant.MIN;
  }
}

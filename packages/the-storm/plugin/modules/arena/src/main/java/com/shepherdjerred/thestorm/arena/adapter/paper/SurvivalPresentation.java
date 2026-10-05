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
  private final SurvivalAmbience ambience;

  SurvivalPresentation(SurvivalRunner runner) {
    this.runner = runner;
    ambience = new SurvivalAmbience(runner);
  }

  void tick() {
    var now = runner.context().time().instant();
    if (now.isBefore(next)) return;
    next = now.plusMillis(250);
    ambience.tick();
    runner.fighters().forEach(this::present);
  }

  private record Marker(BlockPos block, Particle particle, double height) {
    Marker(BlockPos block, Particle particle) {
      this(block, particle, 1.2);
    }
  }

  private void present(Player player) {
    var markers = new java.util.ArrayList<Marker>();
    for (var zone : runner.map().open()) {
      for (var resource : zone.resources())
        markers.add(
            new Marker(
                resource.block(),
                runner.map().state().available(player.getUniqueId(), resource)
                    ? Particle.HAPPY_VILLAGER
                    : Particle.ASH));
      for (var station : zone.stations())
        markers.add(new Marker(station.block(), Particle.ENCHANT));
    }
    for (var machine : runner.map().content().machines())
      if (machine.type() != SurvivalContent.MachineType.MYSTERY_BOX
          && runner
              .map()
              .zone(Places.location(runner.world().world(), machine.block().center()))
              .filter(z -> runner.map().state().accessible(z.id()))
              .isPresent())
        markers.add(
            new Marker(
                machine.block(), machineParticle(machine.type()), machineHeight(machine.type())));
    runner.map().content().boxSites().stream()
        .filter(site -> site.id().equals(runner.machines().box().active()))
        .forEach(
            site ->
                markers.add(
                    new Marker(
                        site.block(),
                        runner.machines().powered() ? Particle.END_ROD : Particle.ASH)));
    markers.stream()
        .filter(marker -> distance(player, marker) <= 144)
        .sorted(java.util.Comparator.comparingDouble(marker -> distance(player, marker)))
        .limit(8)
        .forEach(
            marker ->
                player.spawnParticle(
                    marker.particle(),
                    Places.location(player.getWorld(), marker.block().center())
                        .add(0, marker.height(), 0),
                    4,
                    .4,
                    .35,
                    .4,
                    .01));
    hint(player);
  }

  private static double distance(Player player, Marker marker) {
    return Places.at(player)
        .distanceSquared(Places.location(player.getWorld(), marker.block().center()));
  }

  private static double machineHeight(SurvivalContent.MachineType type) {
    return switch (type) {
      case POWER, STONEWARD, GALESTRIDE, EMBERWEAVE, SOULBOND -> 2.1;
      case RUNEFORGE, FOOD, MYSTERY_BOX -> 1.2;
    };
  }

  private Particle machineParticle(SurvivalContent.MachineType type) {
    if (type != SurvivalContent.MachineType.FOOD && !runner.machines().powered())
      return Particle.ASH;
    return switch (type) {
      case POWER -> Particle.ELECTRIC_SPARK;
      case STONEWARD -> Particle.WAX_ON;
      case GALESTRIDE -> Particle.CLOUD;
      case EMBERWEAVE -> Particle.SMALL_FLAME;
      case SOULBOND -> Particle.HEART;
      case RUNEFORGE -> Particle.ENCHANT;
      case MYSTERY_BOX -> Particle.END_ROD;
      case FOOD -> Particle.HAPPY_VILLAGER;
    };
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
    var route = runner.map().gate(pos);
    if (route.isPresent()) {
      if (!runner.map().state().unlockable(route.orElseThrow())) {
        runner.hud().context(player, runner.actions().routeRequirement(route.orElseThrow()));
        return;
      }
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
                  : "Runic cache · needs power");
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
      case MYSTERY_BOX -> "Runic cache";
      case RUNEFORGE -> "Runeforge";
      case STONEWARD -> "Stoneward shrine";
      case GALESTRIDE -> "Galestride shrine";
      case EMBERWEAVE -> "Emberweave shrine";
      case SOULBOND -> "Soulbond shrine";
    };
  }

  private String machineHint(Player player, SurvivalContent.MachineType type) {
    var name = machineName(type);
    if (type == SurvivalContent.MachineType.POWER)
      return runner.machines().powered() ? "Power on" : name + " · 4 iron + 4 redstone";
    if (type != SurvivalContent.MachineType.FOOD && !runner.machines().powered())
      return name + " · needs power" + perkDescription(type);
    return name
        + " · "
        + switch (type) {
          case FOOD -> "3 bread for 2 emeralds";
          case RUNEFORGE -> {
            yield "select equipment · augment I–III";
          }
          case STONEWARD, GALESTRIDE, EMBERWEAVE, SOULBOND -> {
            var perk =
                com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk.valueOf(type.name());
            yield (runner.actions().has(player, perk) ? "owned" : perk.price() + " emeralds")
                + " · "
                + perk.description();
          }
          case MYSTERY_BOX, POWER -> throw new IllegalStateException("Already handled machine");
        };
  }

  private static String perkDescription(SurvivalContent.MachineType type) {
    return switch (type) {
      case STONEWARD, GALESTRIDE, EMBERWEAVE, SOULBOND ->
          " · "
              + com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk.valueOf(type.name())
                  .description();
      default -> "";
    };
  }

  void reset() {
    next = Instant.MIN;
    ambience.reset();
  }

  void leave(Player player) {
    ambience.stop(player);
  }
}

package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import net.kyori.adventure.text.Component;
import org.bukkit.Particle;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;

/** World-facing labels and personal resource glints make authored interactions recognizable. */
final class SurvivalPresentation {
  private final SurvivalRunner runner;
  private final Map<String, TextDisplay> labels = new HashMap<>();
  private Instant next = Instant.MIN;

  SurvivalPresentation(SurvivalRunner runner) {
    this.runner = runner;
  }

  void tick() {
    var now = runner.context().time().instant();
    if (now.isBefore(next)) return;
    next = now.plusSeconds(1);
    for (var machine : runner.map().content().machines()) {
      if (machine.type() == SurvivalContent.MachineType.MYSTERY_BOX) continue;
      label(
          "machine:" + machine.type(),
          machine.block(),
          machineName(machine.type())
              + "\n"
              + price(machine.type())
              + "\n"
              + powerHint(machine.type()));
    }
    for (var site : runner.map().content().boxSites())
      label("box:" + site.id(), site.block(), runner.machines().box().status(site));
    runner.map().content().zones().forEach(this::district);
    for (var player : runner.fighters()) hint(player);
  }

  private void district(SurvivalContent.Zone zone) {
    var open = runner.map().state().accessible(zone.id());
    var routeStatus = open ? "Route open" : zone.emeralds() + " emeralds · double-click sign";
    for (var sign : zone.purchaseSigns())
      label("route:" + sign, sign, String.join("\n", zone.name(), routeStatus));
    for (var station : zone.stations())
      label(
          "station:" + station.block(),
          station.block(),
          station.type().name().replace('_', ' ') + "\nRight-click · crafting and supplies");
    zone.resources().forEach(resource -> resource(resource, open));
    if (open)
      runner
          .fighters()
          .forEach(
              player ->
                  zone.stations()
                      .forEach(station -> particle(player, station.block(), Particle.ENCHANT)));
  }

  private void resource(SurvivalContent.Resource resource, boolean open) {
    label(
        "resource:" + resource.block(),
        resource.block(),
        "Gather "
            + resource.material().toLowerCase(java.util.Locale.ROOT).replace('_', ' ')
            + "\nRight-click · refills each round");
    if (!open) return;
    for (var player : runner.fighters()) {
      if (runner.map().state().available(player.getUniqueId(), resource))
        particle(player, resource.block(), Particle.HAPPY_VILLAGER);
    }
  }

  private void label(String id, BlockPos pos, String text) {
    var display = labels.get(id);
    if (display == null || !display.isValid()) {
      display =
          runner
              .world()
              .world()
              .spawn(
                  Places.location(runner.world().world(), pos.center()).add(0, 1.2, 0),
                  TextDisplay.class,
                  entity -> {
                    entity.setPersistent(false);
                    entity.setBillboard(org.bukkit.entity.Display.Billboard.CENTER);
                    entity.setViewRange(.15f);
                    entity.setShadowed(true);
                    runner.tag(entity);
                  });
      labels.put(id, display);
    }
    display.text(Component.text(text));
  }

  private void particle(Player player, BlockPos pos, Particle particle) {
    var at = Places.location(player.getWorld(), pos.center()).add(0, .7, 0);
    if (at.distanceSquared(Places.at(player)) <= 576)
      player.spawnParticle(particle, at, 2, .3, .2, .3, 0);
  }

  private void hint(Player player) {
    var block = player.getTargetBlockExact(5);
    if (block == null) return;
    var pos = Places.pos(block);
    runner
        .map()
        .resource(pos)
        .ifPresent(
            resource ->
                runner
                    .hud()
                    .hint(
                        player,
                        runner.map().state().available(player.getUniqueId(), resource)
                            ? "Right-click · gather "
                                + resource.amount()
                                + " "
                                + resource
                                    .material()
                                    .toLowerCase(java.util.Locale.ROOT)
                                    .replace('_', ' ')
                            : "Depleted for you · refills next round",
                        1));
    runner
        .map()
        .station(pos)
        .ifPresent(_ -> runner.hud().hint(player, "Right-click · crafting and team donations", 1));
    runner
        .map()
        .machine(pos)
        .ifPresent(
            machine ->
                runner
                    .hud()
                    .hint(
                        player,
                        machineName(machine.type())
                            + " · "
                            + price(machine.type())
                            + " · "
                            + powerHint(machine.type()),
                        1));
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

  private static String price(SurvivalContent.MachineType type) {
    return switch (type) {
      case FOOD -> "3 bread · 2 emeralds";
      case POWER -> "4 iron + 4 redstone";
      case MYSTERY_BOX -> "16 emeralds";
      case JUGGERNOG -> "24 emeralds";
      case STAMIN_UP -> "20 emeralds";
      case DOUBLE_TAP -> "32 emeralds";
      case QUICK_REVIVE -> "16 emeralds";
      case PACK_A_PUNCH -> "Hold weapon · 36 / 72 / 108 emeralds";
    };
  }

  private String powerHint(SurvivalContent.MachineType type) {
    if (type == SurvivalContent.MachineType.POWER)
      return runner.machines().powered() ? "Power ON" : "Right-click to restore power";
    if (type == SurvivalContent.MachineType.FOOD
        || type == SurvivalContent.MachineType.QUICK_REVIVE
        || runner.machines().powered()) return "Right-click to use";
    return "Requires power at the foundry";
  }

  void reset() {
    labels.values().forEach(TextDisplay::remove);
    labels.clear();
    next = Instant.MIN;
  }
}

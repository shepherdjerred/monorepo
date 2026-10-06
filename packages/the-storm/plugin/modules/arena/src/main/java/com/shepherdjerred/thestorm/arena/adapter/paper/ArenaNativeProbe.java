package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import java.time.InstantSource;
import org.bukkit.Location;
import org.bukkit.entity.AbstractCubeMob;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/** Native acceptance bridge: drives the production factory and goal without reflection. */
public final class ArenaNativeProbe {
  public record Cube(String archetype, Location at, Player target, InstantSource time) {}

  private ArenaNativeProbe() {}

  public static String survival(Plugin plugin, Player player, String action, String value) {
    if (plugin.getServer().getOnlineMode())
      throw new IllegalStateException("Native probes require an offline test server");
    var runner =
        org.bukkit.event.HandlerList.getRegisteredListeners(plugin).stream()
            .map(org.bukkit.plugin.RegisteredListener::getListener)
            .filter(SurvivalListener.class::isInstance)
            .map(SurvivalListener.class::cast)
            .flatMap(listener -> listener.of(player).stream())
            .findFirst()
            .orElseThrow();
    if (!runner.game().debug())
      throw new IllegalStateException("Native probes require a debug run");
    return switch (action) {
      case "unlock" -> {
        runner.probeProgress(player.getUniqueId());
        yield "Unlocked test class progression";
      }
      case "terrain" -> {
        runner.map().content().zones().stream()
            .filter(runner.map().state()::unlockable)
            .forEach(runner.map()::unlock);
        yield "Opened test terrain routes";
      }
      case "hungry" -> {
        player.setSaturation(0);
        player.setFoodLevel(10);
        yield "Prepared native food consumption";
      }
      case "targets" -> {
        for (var index = 0; index < 3; index++) {
          var target =
              runner
                  .world()
                  .spawnAt(
                      new com.shepherdjerred.thestorm.arena.domain.wave.SpawnUnit(
                          "zombie", 100, 1, 1),
                      Places.at(player).clone().add(-4, 0, (index - 1) * 2),
                      true)
                  .orElseThrow()
                  .getFirst();
          runner.combat().probeTarget(target);
          target.setAI(false);
          target.customName(net.kyori.adventure.text.Component.text("Legendary target " + index));
          target.setCustomNameVisible(true);
        }
        yield "Prepared three native legendary targets";
      }
      case "legendary" -> {
        var id = com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon.valueOf(value);
        if (!runner.items().deliver(player, java.util.List.of(runner.items().legendary(id))))
          throw new IllegalStateException("Probe reward does not fit");
        yield "Granted test legendary " + id;
      }
      case "drop" -> {
        var drop = com.shepherdjerred.thestorm.arena.domain.survival.SurvivalDrop.valueOf(value);
        runner.drops().drop(drop, Places.at(player).clone().add(-4, 1, 0));
        yield "Prepared field salvage " + drop;
      }
      case "inspect" -> {
        var build = runner.talents().build(player.getUniqueId());
        yield "Build "
            + build.role()
            + " "
            + build.specialization()
            + " potency="
            + build.potency()
            + " tempo="
            + build.tempo()
            + " pending="
            + build.pending()
            + " box="
            + runner.machines().box().active()
            + " "
            + runner.talents().status(player);
      }
      case "pursuit" ->
          "Fighter "
              + Places.at(player)
              + " entrance="
              + runner.map().entrance(player)
              + " enemies="
              + runner.world().enemies().stream()
                  .map(
                      enemy ->
                          enemy.getType()
                              + " at="
                              + enemy.getLocation()
                              + " target="
                              + (enemy instanceof org.bukkit.entity.Mob mob
                                  ? mob.getTarget()
                                  : "none"))
                  .toList();
      case "cast" -> {
        var boss = runner.combat().boss().orElseThrow();
        var cast = boss.cast().orElseThrow();
        yield String.format(
            java.util.Locale.ROOT,
            "{\"shape\":\"%s\",\"origin\":[%.4f,%.4f,%.4f],\"aim\":[%.4f,%.4f,%.4f]}",
            cast.shape().name(),
            cast.origin().x(),
            cast.origin().y(),
            cast.origin().z(),
            cast.aim().x(),
            cast.aim().y(),
            cast.aim().z());
      }
      case "bank" -> {
        var bank = runner.items().bank();
        var privateItems =
            java.util.Arrays.stream(bank.contents(player.getUniqueId()))
                .filter(java.util.Objects::nonNull)
                .count();
        yield "{\"emeralds\":"
            + bank.supplies().count("EMERALD")
            + ",\"iron\":"
            + bank.supplies().count("IRON_INGOT")
            + ",\"wood\":"
            + bank.supplies().count("OAK_PLANKS")
            + ",\"stone\":"
            + bank.supplies().count("COBBLESTONE")
            + ",\"locker\":"
            + privateItems
            + "}";
      }
      default -> throw new IllegalArgumentException("Unknown native probe action " + action);
    };
  }

  public static void pursue(AbstractCubeMob cube, Player target) {
    ArenaWorld.hunt(cube, target, Places.at(cube).distance(Places.at(target)));
  }

  public static AbstractCubeMob cube(Plugin plugin, WaveTable table, Cube request) {
    var factory = MobFactory.create(new Keys(plugin), table);
    var spawned =
        factory
            .spawn(
                request.at(), request.archetype(), MobFactory.Tuning.relative(1, 1), "settlement")
            .orElseThrow();
    var cube = (AbstractCubeMob) spawned.getFirst();
    cube.setTarget(request.target());
    plugin.getServer().getMobGoals().addGoal(cube, 0, new CubePursuitGoal(cube, request.time()));
    return cube;
  }
}

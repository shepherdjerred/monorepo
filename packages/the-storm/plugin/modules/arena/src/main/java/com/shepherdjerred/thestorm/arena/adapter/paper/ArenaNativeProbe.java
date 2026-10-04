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

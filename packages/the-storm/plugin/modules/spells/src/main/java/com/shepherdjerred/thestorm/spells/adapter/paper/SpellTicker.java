package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.Wards;
import com.shepherdjerred.thestorm.spells.domain.geometry.Knockback;
import com.shepherdjerred.thestorm.spells.domain.geometry.Vec3;
import java.time.InstantSource;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Mob;
import org.bukkit.util.Vector;

/**
 * The spells module's heartbeat, a few times a second: reverts due temporary blocks, pushes
 * monsters out of wards, resets personal skies whose time is up and drops expired timers.
 */
final class SpellTicker {

  private static final double WARD_LIFT = 0.2;

  private final SpellState state;
  private final TemporaryBlocks blocks;
  private final Fx fx;
  private final Clocked world;

  /**
   * Where the ticker acts and when.
   *
   * @param server the server, for worlds and players
   * @param time the clock
   */
  record Clocked(Server server, InstantSource time) {}

  SpellTicker(SpellState state, TemporaryBlocks blocks, Fx fx, Clocked world) {
    this.state = state;
    this.blocks = blocks;
    this.fx = fx;
    this.world = world;
  }

  void tick() {
    var now = world.time().instant();
    blocks.sweep();
    for (var ward : state.wards().active(now)) {
      hold(ward);
    }
    for (var player : state.timeShifts().expire(now)) {
      var online = world.server().getPlayer(player);
      if (online != null) {
        online.resetPlayerTime();
      }
    }
    state.stealth().expire(now);
    state.featherFall().expire(now);
    state.silences().expire(now);
    state.cooldowns().expire(now);
  }

  /** Pushes every hostile monster inside {@code ward} back out. */
  private void hold(Wards.Ward ward) {
    var key = NamespacedKey.fromString(ward.world());
    var bukkitWorld = key == null ? null : world.server().getWorld(key);
    if (bukkitWorld == null) {
      return;
    }
    var centre = ward.centre();
    var location = new Location(bukkitWorld, centre.x(), centre.y(), centre.z());
    for (var mob :
        bukkitWorld.getNearbyEntitiesByType(
            Mob.class, location, ward.radius(), Enemy.class::isInstance)) {
      var at = mob.getLocation();
      var point = new Vec3(at.getX(), at.getY(), at.getZ());
      if (ward.contains(ward.world(), point)) {
        var push = Knockback.away(centre, point, ward.push(), WARD_LIFT);
        mob.setVelocity(new Vector(push.x(), push.y(), push.z()));
        mob.setTarget(null);
        fx.burst(SpellKind.WARD, at.add(0, 1, 0), 3, 0.2);
      }
    }
  }
}

package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.adapter.paper.spell.Toolbox;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.Wards;
import com.shepherdjerred.thestorm.spells.domain.geometry.Knockback;
import com.shepherdjerred.thestorm.spells.domain.geometry.Vec3;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Mob;
import org.bukkit.util.Vector;

/**
 * The spells module's heartbeat, a few times a second: reverts due temporary blocks, pushes
 * monsters out of wards, resets personal skies whose time is up and drops expired timers.
 */
final class SpellTicker {

  private static final double WARD_LIFT = 0.2;

  private final Toolbox tools;

  SpellTicker(Toolbox tools) {
    this.tools = tools;
  }

  void tick() {
    var state = tools.state();
    var now = tools.time().instant();
    tools.blocks().sweep();
    for (var ward : state.wards().active(now)) {
      hold(ward);
    }
    for (var player : state.timeShifts().expire(now)) {
      var online = tools.server().getPlayer(player);
      if (online != null) {
        online.resetPlayerTime();
      }
    }
    state.stealth().expire(now);
    state.featherFall().expire(now);
    state.silences().expire(now);
    state.cooldowns().expire(now);
  }

  /**
   * Pushes hostile monsters inside {@code ward} back out. Immune bosses are never pushed, nor are
   * monsters on land where the ward's caster may not build (mob farms in someone's claim).
   */
  private void hold(Wards.Ward ward) {
    var key = NamespacedKey.fromString(ward.world());
    var world = key == null ? null : tools.server().getWorld(key);
    if (world == null) {
      return;
    }
    var centre = ward.centre();
    var location = new Location(world, centre.x(), centre.y(), centre.z());
    for (var mob :
        world.getNearbyEntitiesByType(
            Mob.class, location, ward.radius(), Enemy.class::isInstance)) {
      var at = mob.getLocation();
      var point = new Vec3(at.getX(), at.getY(), at.getZ());
      if (!ward.contains(ward.world(), point)
          || tools.targets().isImmune(mob)
          || tools.guard().harmDenial(ward.owner(), location, mob).isPresent()) {
        continue;
      }
      var push = Knockback.away(centre, point, ward.push(), WARD_LIFT);
      mob.setVelocity(new Vector(push.x(), push.y(), push.z()));
      mob.setTarget(null);
      tools.fx().burst(SpellKind.WARD, at.add(0, 1, 0), 3, 0.2);
    }
  }
}

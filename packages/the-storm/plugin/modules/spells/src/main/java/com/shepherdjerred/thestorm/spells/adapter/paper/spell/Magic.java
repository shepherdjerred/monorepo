package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.spells.domain.geometry.Vec3;
import org.bukkit.Location;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;

/** Small helpers every spell uses. */
final class Magic {

  static final int TICKS_PER_SECOND = 20;

  private Magic() {}

  static int ticks(int seconds) {
    return seconds * TICKS_PER_SECOND;
  }

  /**
   * Magic damage caused by {@code caster}, so the server (and the towns module's PvP listener) sees
   * who hurt whom.
   */
  static void hurt(LivingEntity target, double amount, Player caster) {
    if (amount <= 0) {
      return;
    }
    var source =
        DamageSource.builder(DamageType.MAGIC)
            .withCausingEntity(caster)
            .withDirectEntity(caster)
            .build();
    target.damage(amount, source);
  }

  static void potion(LivingEntity target, PotionEffectType type, int seconds, int amplifier) {
    target.addPotionEffect(new PotionEffect(type, ticks(seconds), amplifier, false, true, true));
  }

  static Vec3 vec(Location location) {
    return new Vec3(location.getX(), location.getY(), location.getZ());
  }

  static Vector vector(Vec3 vec) {
    return new Vector(vec.x(), vec.y(), vec.z());
  }

  /**
   * Where {@code player} is. Through {@link Entity}, not {@code OfflinePlayer}, whose location is
   * nullable: an online player is always somewhere.
   */
  static Location at(Player player) {
    Entity entity = player;
    return entity.getLocation();
  }

  /** The middle of {@code target}'s body, for particle lines. */
  static Location chest(LivingEntity target) {
    return target.getLocation().add(0, target.getHeight() / 2, 0);
  }
}

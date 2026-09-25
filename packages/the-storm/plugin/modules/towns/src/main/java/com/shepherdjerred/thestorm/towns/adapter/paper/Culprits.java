package com.shepherdjerred.thestorm.towns.adapter.paper;

import java.util.Optional;
import java.util.UUID;
import org.bukkit.NamespacedKey;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.AreaEffectCloud;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.LightningStrike;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.entity.Tameable;
import org.bukkit.persistence.PersistentDataType;
import org.jspecify.annotations.Nullable;

/**
 * Finds the player behind an entity: the player themselves, the shooter of a projectile, whoever
 * lit primed TNT, the thrower of a potion cloud or a dropped item, the player who called channeling
 * lightning, a tamed pet's owner, or the player who built a wither. Owners and throwers count even
 * when offline.
 */
final class Culprits {

  /** How many hops (TNT lit by an arrow shot by a player) are followed. */
  private static final int MAX_DEPTH = 4;

  private final NamespacedKey builderKey;

  /**
   * @param builderKey where a wither remembers the player who built it
   */
  Culprits(NamespacedKey builderKey) {
    this.builderKey = builderKey;
  }

  /** Records {@code builder} as the culprit for everything {@code wither} does. */
  void rememberBuilder(Entity wither, UUID builder) {
    wither
        .getPersistentDataContainer()
        .set(builderKey, PersistentDataType.STRING, builder.toString());
  }

  Optional<Culprit> behind(@Nullable Entity entity) {
    return behind(entity, MAX_DEPTH);
  }

  Optional<Culprit> behind(DamageSource source) {
    var causing = source.getCausingEntity();
    return causing != null ? behind(causing) : behind(source.getDirectEntity());
  }

  /**
   * The player behind an entity pressing a block: as {@link #behind(Entity)}, else a player riding
   * it, else whoever holds it on a lead.
   */
  Optional<Culprit> presser(Entity entity) {
    return behind(entity)
        .or(
            () ->
                entity.getPassengers().stream()
                    .filter(Player.class::isInstance)
                    .map(Player.class::cast)
                    .findFirst()
                    .map(Culprit::of))
        .or(
            () ->
                entity instanceof LivingEntity living && living.isLeashed()
                    ? behind(living.getLeashHolder())
                    : Optional.empty());
  }

  /**
   * True when {@code source} is an explosion: TNT, creepers, crystals, beds, anchors, fireworks.
   */
  static boolean isExplosion(DamageSource source) {
    var type = source.getDamageType();
    return type.equals(DamageType.EXPLOSION)
        || type.equals(DamageType.PLAYER_EXPLOSION)
        || type.equals(DamageType.BAD_RESPAWN_POINT)
        || type.equals(DamageType.FIREWORKS);
  }

  private Optional<Culprit> behind(@Nullable Entity entity, int depth) {
    if (entity == null || depth == 0) {
      return Optional.empty();
    }
    return switch (entity) {
      case Player player -> Optional.of(Culprit.of(player));
      case Projectile projectile ->
          projectile.getShooter() instanceof Entity shooter
              ? behind(shooter, depth - 1)
              : Optional.empty();
      case TNTPrimed tnt -> behind(tnt.getSource(), depth - 1);
      case AreaEffectCloud cloud ->
          cloud.getSource() instanceof Entity source ? behind(source, depth - 1) : Optional.empty();
      case LightningStrike lightning -> behind(lightning.getCausingEntity(), depth - 1);
      case Item item -> byId(item.getThrower(), entity);
      case Tameable pet when pet.isTamed() -> byId(pet.getOwnerUniqueId(), entity);
      default -> builder(entity);
    };
  }

  private Optional<Culprit> builder(Entity entity) {
    var stored = entity.getPersistentDataContainer().get(builderKey, PersistentDataType.STRING);
    return stored == null ? Optional.empty() : byId(UUID.fromString(stored), entity);
  }

  private static Optional<Culprit> byId(@Nullable UUID id, Entity proxy) {
    if (id == null) {
      return Optional.empty();
    }
    return Optional.of(new Culprit(id, proxy.getServer().getPlayer(id), proxy.getLocation()));
  }
}

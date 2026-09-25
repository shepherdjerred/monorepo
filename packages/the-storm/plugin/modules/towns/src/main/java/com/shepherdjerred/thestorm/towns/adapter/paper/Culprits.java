package com.shepherdjerred.thestorm.towns.adapter.paper;

import io.papermc.paper.entity.Leashable;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.AreaEffectCloud;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.LightningStrike;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.entity.Tameable;
import org.bukkit.persistence.PersistentDataType;
import org.jspecify.annotations.Nullable;

/**
 * Finds the player behind an entity: the player themselves, the shooter of a projectile, whoever
 * lit primed TNT, the thrower of a potion cloud or a freshly dropped item, the player who called
 * channeling lightning, a tamed pet's owner, or the player who built a wither. Owners and throwers
 * count even when offline.
 */
final class Culprits {

  /** How many hops (TNT lit by an arrow shot by a player) are followed. */
  private static final int MAX_DEPTH = 4;

  /** The builder of a wither nobody built, such as one a dispenser completed: nobody's member. */
  static final UUID NOBODY = new UUID(0, 0);

  private final Keys keys;
  private final int itemMemoryTicks;

  /**
   * Where entities remember who is behind them.
   *
   * @param builder a wither's builder
   * @param thrower a lingering potion cloud's thrower
   * @param origin a lingering potion cloud's origin, as block coordinates in the cloud's world
   */
  record Keys(NamespacedKey builder, NamespacedKey thrower, NamespacedKey origin) {}

  /**
   * @param keys where entities remember who is behind them
   * @param itemMemoryTicks how long a dropped item still counts as its thrower's act; after that,
   *     anyone may have moved it
   */
  Culprits(Keys keys, int itemMemoryTicks) {
    this.keys = keys;
    this.itemMemoryTicks = itemMemoryTicks;
  }

  /** Records {@code builder} as the culprit for everything {@code wither} does. */
  void rememberBuilder(Entity wither, UUID builder) {
    wither
        .getPersistentDataContainer()
        .set(keys.builder(), PersistentDataType.STRING, builder.toString());
  }

  /**
   * Records who threw the potion a lingering cloud came from and where it was thrown from, so the
   * cloud answers for them after the thrower logs out or the dispenser is gone.
   */
  void rememberCloud(AreaEffectCloud cloud, Optional<Culprit> thrower, Location origin) {
    var data = cloud.getPersistentDataContainer();
    thrower.ifPresent(
        culprit -> data.set(keys.thrower(), PersistentDataType.STRING, culprit.id().toString()));
    data.set(
        keys.origin(),
        PersistentDataType.INTEGER_ARRAY,
        new int[] {origin.getBlockX(), origin.getBlockY(), origin.getBlockZ()});
  }

  /**
   * Where {@code entity}'s effect comes from (see {@link Origins}), a cloud's recorded origin
   * first.
   */
  Location origin(Entity entity) {
    if (entity instanceof AreaEffectCloud cloud) {
      var stored =
          cloud.getPersistentDataContainer().get(keys.origin(), PersistentDataType.INTEGER_ARRAY);
      if (stored != null && stored.length == 3) {
        return new Location(cloud.getWorld(), stored[0], stored[1], stored[2]);
      }
    }
    return Origins.of(entity);
  }

  Optional<Culprit> behind(@Nullable Entity entity) {
    return behind(entity, MAX_DEPTH);
  }

  Optional<Culprit> behind(DamageSource source) {
    var causing = source.getCausingEntity();
    return causing != null ? behind(causing) : behind(source.getDirectEntity());
  }

  /**
   * The players answerable for what {@code entity} does to a block or creature. Players controlling
   * it come first and all of them count: whoever rides it and whoever holds it on a lead. Only when
   * nobody controls it does the player behind it count (a pet's owner, a projectile's shooter), so
   * nobody borrows a friend's pet to get their rights.
   */
  List<Culprit> controllers(Entity entity) {
    var controlling = new ArrayList<Culprit>(1);
    for (var passenger : entity.getPassengers()) {
      if (passenger instanceof Player player) {
        controlling.add(Culprit.of(player));
      }
    }
    if (entity instanceof Leashable leashed && leashed.isLeashed()) {
      behind(leashed.getLeashHolder()).ifPresent(controlling::add);
    }
    if (!controlling.isEmpty()) {
      return List.copyOf(controlling);
    }
    var behind = behind(entity);
    return behind.isPresent() ? List.of(behind.get()) : List.of();
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
          cloud.getSource() instanceof Entity source
              ? behind(source, depth - 1)
              : stored(cloud, keys.thrower());
      case LightningStrike lightning -> behind(lightning.getCausingEntity(), depth - 1);
      case Item item ->
          item.getTicksLived() <= itemMemoryTicks
              ? byId(item.getThrower(), entity)
              : Optional.empty();
      case Tameable pet when pet.isTamed() -> byId(pet.getOwnerUniqueId(), entity);
      default -> stored(entity, keys.builder());
    };
  }

  private static Optional<Culprit> stored(Entity entity, NamespacedKey key) {
    var stored = entity.getPersistentDataContainer().get(key, PersistentDataType.STRING);
    return stored == null ? Optional.empty() : byId(UUID.fromString(stored), entity);
  }

  private static Optional<Culprit> byId(@Nullable UUID id, Entity proxy) {
    if (id == null) {
      return Optional.empty();
    }
    return Optional.of(new Culprit(id, proxy.getServer().getPlayer(id), proxy.getLocation()));
  }
}

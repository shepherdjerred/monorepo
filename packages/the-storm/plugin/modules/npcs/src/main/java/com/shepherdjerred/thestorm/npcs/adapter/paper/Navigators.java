package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.movement.Observation;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Ageable;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Mob;
import org.bukkit.persistence.PersistentDataType;

/**
 * Hidden mobs that plan NPC walks. A Mannequin has no pathfinder, so each walking NPC borrows one:
 * an invisible, silent, invulnerable, goal-less passive mob spawned where the NPC stands, hidden
 * from every client. It never moves on purpose; it only answers {@code findPath}, which returns
 * nothing until it has landed, so callers retry each tick. Main thread.
 */
final class Navigators {

  private final Server server;
  private final NpcKeys keys;
  private final Class<? extends Mob> type;
  private final double followRange;
  private final Map<String, Mob> active = new HashMap<>();

  Navigators(Server server, NpcKeys keys, Class<? extends Mob> type, double followRange) {
    this.server = server;
    this.keys = keys;
    this.type = type;
    this.followRange = followRange;
  }

  /**
   * The mob class for {@code type}, which must be a spawnable passive mob: monsters do not exist in
   * Peaceful.
   */
  static Class<? extends Mob> mobClass(EntityType type) {
    var entityClass = type.getEntityClass();
    if (!type.isSpawnable()
        || entityClass == null
        || !Mob.class.isAssignableFrom(entityClass)
        || Enemy.class.isAssignableFrom(entityClass)) {
      throw new IllegalArgumentException(
          "navigator entity " + type.getKey() + " must be a spawnable, non-hostile mob");
    }
    return entityClass.asSubclass(Mob.class);
  }

  /** Asks {@code npc}'s navigator, standing at {@code from}, for a path to {@code target}. */
  Optional<Observation.Path> find(String npc, Location from, Vec3 target) {
    var navigator = active.get(npc);
    if (navigator == null || !navigator.isValid()) {
      navigator = spawn(from);
      active.put(npc, navigator);
    }
    var destination = new Location(from.getWorld(), target.x(), target.y(), target.z());
    var path = navigator.getPathfinder().findPath(destination);
    if (path == null) {
      return Optional.empty();
    }
    var waypoints =
        path.getPoints().stream()
            .map(point -> new Vec3(point.getBlockX() + 0.5, point.getY(), point.getBlockZ() + 0.5))
            .toList();
    return Optional.of(new Observation.Path(waypoints, path.canReachFinalPoint()));
  }

  void release(String npc) {
    var navigator = active.remove(npc);
    if (navigator != null) {
      navigator.remove();
    }
  }

  void releaseAll() {
    active.values().forEach(Entity::remove);
    active.clear();
  }

  boolean isNavigator(Entity entity) {
    return entity.getPersistentDataContainer().has(keys.navigator(), PersistentDataType.BYTE);
  }

  private Mob spawn(Location at) {
    var world = Objects.requireNonNull(at.getWorld(), "navigator location has no world");
    var mob =
        world.spawn(
            at,
            type,
            spawned -> {
              spawned.setVisibleByDefault(false);
              spawned.setInvisible(true);
              spawned.setSilent(true);
              spawned.setInvulnerable(true);
              spawned.setPersistent(false);
              spawned.setCollidable(false);
              spawned.setCanPickupItems(false);
              if (spawned instanceof Ageable ageable) {
                ageable.setAdult();
              }
              var range =
                  Objects.requireNonNull(
                      spawned.getAttribute(Attribute.FOLLOW_RANGE), "mobs have a follow range");
              range.setBaseValue(followRange);
              spawned
                  .getPersistentDataContainer()
                  .set(keys.navigator(), PersistentDataType.BYTE, (byte) 1);
            });
    server.getMobGoals().removeAllGoals(mob);
    return mob;
  }
}

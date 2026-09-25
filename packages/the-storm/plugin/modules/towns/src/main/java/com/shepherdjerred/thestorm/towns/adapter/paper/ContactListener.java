package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import io.papermc.paper.entity.Leashable;
import io.papermc.paper.event.entity.EntityCollideWithEntityEvent;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Tameable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.EntityTransformEvent;
import org.bukkit.event.entity.ItemSpawnEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerAttemptPickupItemEvent;
import org.bukkit.event.vehicle.VehicleEntityCollisionEvent;
import org.jspecify.annotations.Nullable;

/**
 * Touching protected things without using them: players shoving animals and vehicles out of a town
 * by walking into them, picking up items lying on someone's land, and lightning turning a town's
 * villagers and pigs into witches and piglins.
 */
final class ContactListener implements Listener {

  /** How far (in blocks) a death drop spawns from where its owner died. */
  private static final double DROP_REACH = 3.0;

  static final Act TAKE = new Act(Action.OPEN_CONTAINER, Subject.ENTITY);

  private final Guard guard;
  private final Server server;
  private @Nullable Death lastDeath;

  private record Death(UUID player, Location at, int tick) {}

  ContactListener(Guard guard, Server server) {
    this.guard = guard;
    this.server = server;
  }

  /**
   * An outsider walking into a town's animal or vehicle does not push it. Collisions between mobs
   * fire constantly, so anything without a player returns at once.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onCollide(EntityCollideWithEntityEvent event) {
    var entities = event.getEntities();
    if (entities.size() != 2) {
      return;
    }
    var first = entities.get(0);
    var second = entities.get(1);
    if (shoves(first, second) || shoves(second, first)) {
      event.setCancelled(true);
    }
  }

  /** A boat or cart ridden or led by an outsider does not shove a town's animals either. */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onVehicleCollide(VehicleEntityCollisionEvent event) {
    var vehicle = event.getVehicle();
    var entity = event.getEntity();
    if (shoves(entity, vehicle) || shoves(vehicle, entity)) {
      event.setCancelled(true);
    }
  }

  /**
   * True when {@code pusher} is answerable to a player who may not move {@code pushed}: a player,
   * or something a player rides, leads or owns. Anything else (mobs bumping in a pen) returns
   * before any land lookup.
   */
  private boolean shoves(Entity pusher, Entity pushed) {
    if (!(pusher instanceof Player) && !isControlled(pusher)) {
      return false;
    }
    var subject = EntityKinds.subject(pushed);
    if (subject.isEmpty()) {
      return false;
    }
    var land = guard.land(pushed);
    if (land instanceof Land.Wilderness) {
      return false;
    }
    var move = new Act(Action.INTERACT_ENTITY, subject.get());
    for (var controller : guard.controllers(pusher)) {
      if (!EntityKinds.isPetOf(pushed, controller.id())
          && !guard.permitsQuietly(controller, move, land)) {
        return true;
      }
    }
    return false;
  }

  private static boolean isControlled(Entity entity) {
    return !entity.isEmpty()
        || (entity instanceof Leashable leashed && leashed.isLeashed())
        || (entity instanceof Tameable pet && pet.isTamed());
  }

  /**
   * A mob (an allay, a fox, a villager) picking up an item lying on protected land takes it for
   * whoever controls it, who must be allowed to; a mob nobody controls must come from that land.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onMobPickup(EntityPickupItemEvent event) {
    var picker = event.getEntity();
    if (picker instanceof Player) {
      return;
    }
    var land = guard.land(event.getItem());
    if (land instanceof Land.Wilderness) {
      return;
    }
    var controllers = guard.controllers(picker);
    var allowed =
        controllers.isEmpty()
            ? Guard.flows(WorldEffect.ITEM_TRANSFER, land, guard.land(guard.origin(picker)))
            : guard.allPermitQuietly(controllers, TAKE, land);
    if (!allowed) {
      event.setCancelled(true);
    }
  }

  /**
   * Items lying on someone's land belong to that land: only players who may open its containers
   * pick them up, except that anyone may pick up what they dropped themselves, their death drops
   * included.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPickup(PlayerAttemptPickupItemEvent event) {
    var player = event.getPlayer();
    var item = event.getItem();
    if (player.getUniqueId().equals(item.getThrower())) {
      return;
    }
    var land = guard.land(item);
    if (!(land instanceof Land.Wilderness) && !guard.permitsQuietly(player, TAKE, land)) {
      event.setCancelled(true);
      event.setFlyAtPlayer(false);
    }
  }

  /** Remembers a death so the drops that spawn right after can be marked as the dead player's. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDeath(PlayerDeathEvent event) {
    var player = event.getPlayer();
    lastDeath = new Death(player.getUniqueId(), Guard.position(player), server.getCurrentTick());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDrop(ItemSpawnEvent event) {
    var death = lastDeath;
    var item = event.getEntity();
    if (death == null
        || item.getThrower() != null
        || death.tick() != server.getCurrentTick()
        || !Guard.world(death.at()).equals(item.getWorld())
        || death.at().distance(item.getLocation()) > DROP_REACH) {
      return;
    }
    item.setThrower(death.player());
  }

  /** Lightning never turns a protected villager, pig or other creature on someone's land. */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onTransform(EntityTransformEvent event) {
    if (event.getTransformReason() != EntityTransformEvent.TransformReason.LIGHTNING) {
      return;
    }
    var entity = event.getEntity();
    if (EntityKinds.subject(entity).isPresent()
        && !(guard.land(entity) instanceof Land.Wilderness)) {
      event.setCancelled(true);
    }
  }
}

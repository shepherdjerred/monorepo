package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import io.papermc.paper.event.player.PlayerItemFrameChangeEvent;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Vehicle;
import org.bukkit.event.Cancellable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockShearEntityEvent;
import org.bukkit.event.entity.EntityMountEvent;
import org.bukkit.event.entity.EntityPlaceEvent;
import org.bukkit.event.entity.PlayerLeashEntityEvent;
import org.bukkit.event.hanging.HangingBreakByEntityEvent;
import org.bukkit.event.hanging.HangingBreakEvent;
import org.bukkit.event.hanging.HangingPlaceEvent;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerBucketEntityEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerShearEntityEvent;
import org.bukkit.event.player.PlayerUnleashEntityEvent;
import org.bukkit.event.vehicle.VehicleDamageEvent;
import org.bukkit.event.vehicle.VehicleDestroyEvent;
import org.bukkit.event.vehicle.VehicleEnterEvent;

/**
 * Players using, placing and breaking entities: item frames, armor stands, paintings, leads,
 * vehicles, mounts, animals and villagers; and the world breaking hanging entities.
 */
final class EntityListener implements Listener {

  private final Guard guard;

  EntityListener(Guard guard) {
    this.guard = guard;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onInteractEntity(PlayerInteractEntityEvent event) {
    var entity = event.getRightClicked();
    EntityKinds.use(entity).ifPresent(act -> use(event, event.getPlayer(), entity, act));
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onArmorStand(PlayerArmorStandManipulateEvent event) {
    use(
        event,
        event.getPlayer(),
        event.getRightClicked(),
        new Act(Action.INTERACT_ENTITY, Subject.ARMOR_STAND));
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onItemFrame(PlayerItemFrameChangeEvent event) {
    use(
        event,
        event.getPlayer(),
        event.getItemFrame(),
        new Act(Action.INTERACT_ENTITY, Subject.ITEM_FRAME));
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onShear(PlayerShearEntityEvent event) {
    interactWith(event, event.getPlayer(), event.getEntity());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onLeash(PlayerLeashEntityEvent event) {
    interactWith(event, event.getPlayer(), event.getEntity());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onUnleash(PlayerUnleashEntityEvent event) {
    interactWith(event, event.getPlayer(), event.getEntity());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBucketEntity(PlayerBucketEntityEvent event) {
    interactWith(event, event.getPlayer(), event.getEntity());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onVehicleEnter(VehicleEnterEvent event) {
    var entered = event.getEntered();
    if (entered instanceof Player player) {
      interactWith(event, player, event.getVehicle());
    } else if (!mayCarry(event.getVehicle(), entered)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onMount(EntityMountEvent event) {
    var rider = event.getEntity();
    if (rider instanceof Player player) {
      if (!(event.getMount() instanceof Vehicle)) {
        interactWith(event, player, event.getMount());
      }
    } else if (!mayCarry(event.getMount(), rider)) {
      event.setCancelled(true);
    }
  }

  /**
   * A boat or minecart may pick up a protected animal or villager on someone's land only when it
   * sits on the same owner's land and no outsider rides it or holds the animal or the vehicle on a
   * lead: otherwise a boat pushed into a pen carries the animals off.
   */
  private boolean mayCarry(Entity vehicle, Entity passenger) {
    var subject = EntityKinds.subject(passenger);
    if (subject.isEmpty()) {
      return true;
    }
    var land = guard.land(passenger);
    if (land instanceof Land.Wilderness) {
      return true;
    }
    if (!land.sameOwnerAs(guard.land(vehicle))) {
      return false;
    }
    var use = new Act(Action.INTERACT_ENTITY, subject.get());
    for (var handler : List.of(vehicle, passenger)) {
      var culprit = guard.presser(handler);
      if (culprit.isPresent() && !guard.permitsQuietly(culprit.get(), use, land)) {
        return false;
      }
    }
    return true;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onFish(PlayerFishEvent event) {
    var caught = event.getCaught();
    if (event.getState() == PlayerFishEvent.State.CAUGHT_ENTITY
        && caught != null
        && !guard.permitsHarm(event.getPlayer(), caught, true)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onVehicleDamage(VehicleDamageEvent event) {
    breakVehicle(event, event.getVehicle(), event.getDamageSource());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onVehicleDestroy(VehicleDestroyEvent event) {
    breakVehicle(event, event.getVehicle(), event.getDamageSource());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onEntityPlace(EntityPlaceEvent event) {
    var player = event.getPlayer();
    if (player == null) {
      return;
    }
    var entity = event.getEntity();
    var subject = EntityKinds.subject(entity).orElse(Subject.ENTITY);
    if (!guard.permits(player, new Act(Action.PLACE_ENTITY, subject), guard.land(entity))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onHangingPlace(HangingPlaceEvent event) {
    var player = event.getPlayer();
    if (player == null) {
      return;
    }
    var hanging = event.getEntity();
    var subject = EntityKinds.subject(hanging).orElse(Subject.ENTITY);
    if (!guard.permits(player, new Act(Action.PLACE_ENTITY, subject), guard.land(hanging))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onHangingBreak(HangingBreakEvent event) {
    var hanging = event.getEntity();
    var land = guard.land(hanging);
    if (event instanceof HangingBreakByEntityEvent byEntity && byEntity.getRemover() != null) {
      var remover = byEntity.getRemover();
      var culprit = guard.culprit(remover);
      if (culprit.isPresent()) {
        var act = new Act(Action.BREAK, EntityKinds.subject(hanging).orElse(Subject.ENTITY));
        event.setCancelled(!guard.permits(culprit.get(), act, land));
        return;
      }
      var effect =
          event.getCause() == HangingBreakEvent.RemoveCause.EXPLOSION
              ? WorldEffect.EXPLOSION
              : WorldEffect.PROJECTILE_IMPACT;
      event.setCancelled(!Guard.flows(effect, guard.land(Origins.of(remover)), land));
      return;
    }
    if (event.getCause() == HangingBreakEvent.RemoveCause.EXPLOSION) {
      event.setCancelled(!Guard.flows(WorldEffect.EXPLOSION, land, land));
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onDispenserShear(BlockShearEntityEvent event) {
    if (!Guard.flows(
        WorldEffect.DISPENSE, guard.land(event.getBlock()), guard.land(event.getEntity()))) {
      event.setCancelled(true);
    }
  }

  private void interactWith(Cancellable event, Player player, Entity entity) {
    var subject = EntityKinds.subject(entity);
    if (subject.isPresent()) {
      use(event, player, entity, new Act(Action.INTERACT_ENTITY, subject.get()));
    }
  }

  private void use(Cancellable event, Player player, Entity entity, Act act) {
    if (!guard.permitsUse(player, entity, act)) {
      event.setCancelled(true);
    }
  }

  /**
   * A player may break a vehicle where they may hurt entities; an explosion only within land that
   * allows explosions; mobs and other causes may.
   */
  private void breakVehicle(Cancellable event, Entity vehicle, DamageSource source) {
    var culprit = guard.culprit(source);
    if (culprit.isPresent()) {
      if (!guard.permitsHarm(culprit.get(), vehicle, true)) {
        event.setCancelled(true);
      }
      return;
    }
    if (Culprits.isExplosion(source)
        && !Guard.flows(
            WorldEffect.EXPLOSION, guard.land(origin(source, vehicle)), guard.land(vehicle))) {
      event.setCancelled(true);
    }
  }

  private static Location origin(DamageSource source, Entity victim) {
    var from = source.getSourceLocation();
    return from != null ? from : victim.getLocation();
  }
}

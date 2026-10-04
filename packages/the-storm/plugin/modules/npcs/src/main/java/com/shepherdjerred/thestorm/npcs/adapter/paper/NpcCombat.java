package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.npcs.app.NpcStateStore;
import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger;
import com.shepherdjerred.thestorm.npcs.domain.combat.WarningDeck;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/** Main-thread encounters and perception, backed by the durable pure warning/death ledger. */
final class NpcCombat {
  private record Encounter(UUID target, Location origin, boolean defend, long untilTick) {
    Encounter {
      origin = origin.clone();
    }
  }

  private record Seen(long tick, Optional<LivingEntity> threat) {}

  private final NpcWorld world;
  private final NpcsConfig config;
  private final ModuleContext context;
  private final NpcStateStore store;
  private final NpcLedger ledger = new NpcLedger();
  private final WarningDeck warnings;
  private final Map<String, Encounter> encounters = new HashMap<>();
  private final Map<String, Seen> observations = new HashMap<>();
  private final Map<String, UUID> retreated = new HashMap<>();
  private boolean ready;
  private boolean closed;
  private long tick;

  NpcCombat(NpcWorld world, NpcsConfig config, ModuleContext context, NpcStateStore store) {
    this.world = world;
    this.config = config;
    this.context = context;
    this.store = store;
    warnings = new WarningDeck(config.warningPhrases(), context.random());
  }

  void initialize() {
    var _ =
        store
            .load()
            .whenCompleteAsync(
                (snapshot, failure) -> {
                  if (closed) {
                    return;
                  }
                  if (failure != null) {
                    fail(failure);
                    return;
                  }
                  try {
                    ledger.restore(snapshot);
                    ready = true;
                    expire();
                    context.logger().info("NPCs: {}", world.reconcile());
                  } catch (RuntimeException error) {
                    fail(error);
                  }
                },
                context.scheduler().mainThread());
  }

  boolean ready() {
    return ready && !closed;
  }

  boolean awaitingDawn(String npc) {
    return ledger.awaitingDawn(npc);
  }

  boolean reacting(String npc) {
    var seen = observations.get(npc);
    return encounters.containsKey(npc) || (seen != null && seen.threat().isPresent());
  }

  /** Called before animation, including when no players are nearby. */
  void tick() {
    tick++;
    if (tick % config.animation().thinkIntervalTicks() == 0 && expire()) {
      world.reconcile();
    }
  }

  void hit(NpcDefinition npc, LivingEntity victim, LivingEntity attacker, boolean lethal) {
    if (!ready() || !responsible(attacker) || victim.equals(attacker)) {
      return;
    }
    // A fresh attack is a new incident, even if the attacker escaped an earlier pursuit.
    retreated.values().removeIf(attacker.getUniqueId()::equals);
    var defend = true;
    if (attacker instanceof Player player) {
      var at = victim.getWorld();
      var response =
          ledger.hit(
              new NpcLedger.Attack(
                  at.getKey().asString(), npc.id(), player.getUniqueId(), at.getFullTime()),
              lethal);
      persist();
      defend = response == NpcLedger.Response.DEFEND;
      if (!defend) {
        var suffix =
            response == NpcLedger.Response.FINAL_WARNING
                ? " Final warning: one more hit and the guards will attack."
                : " Warning 1 of 2.";
        player.sendMessage(HouseStyle.error(npc.name(), Component.text(warnings.next() + suffix)));
      } else {
        player.sendMessage(
            HouseStyle.error(npc.name(), Component.text("The Watch will defend us!")));
      }
    }
    if (!eligible(attacker)) {
      // Projectile owners can disconnect before impact; the durable offense still counts.
      return;
    }
    encounters.put(
        npc.id(),
        new Encounter(
            attacker.getUniqueId(),
            victim.getLocation(),
            defend,
            defend ? Long.MAX_VALUE : tick + 100));
    observations.remove(npc.id());
    world.interrupt(npc.id());
    if (defend) {
      alert(victim.getLocation(), attacker);
    }
  }

  void died(NpcDefinition npc, LivingEntity victim, Optional<LivingEntity> attacker) {
    if (!ready()) {
      throw new IllegalStateException("NPC death before state hydration");
    }
    var at = victim.getWorld();
    attacker
        .filter(this::responsible)
        .ifPresent(
            source -> {
              if (source instanceof Player player) {
                ledger.accuse(at.getKey().asString(), player.getUniqueId(), at.getFullTime());
              }
              if (eligible(source)) {
                alert(victim.getLocation(), source);
              }
            });
    ledger.died(at.getKey().asString(), npc.id(), at.getFullTime());
    persist();
    forget(npc.id());
    world.interrupt(npc.id());
  }

  Optional<LivingEntity> threat(NpcDefinition npc, LivingEntity entity) {
    var feet = entity.getLocation();
    releaseRetreat(npc.id(), feet);
    var guard = npc.roles().contains("guard");
    var encounter = encounters.get(npc.id());
    if (encounter != null) {
      var assigned = assigned(npc.id(), encounter, feet, guard);
      if (assigned.isPresent()) {
        return assigned;
      }
      encounters.remove(npc.id());
    }
    var seen = observations.get(npc.id());
    if (seen == null || tick - seen.tick() >= config.animation().thinkIntervalTicks()) {
      var radius = config.guard().detectionRadius();
      var nearby =
          GuardThreats.nearest(
              feet.getWorld().getNearbyEntities(feet, radius, radius, radius),
              new GuardThreats.Search(feet, config.guard()),
              new GuardThreats.Filters(
                  target -> eligible(target) && !retreating(npc.id(), target),
                  target -> wanted(target, feet),
                  entity::hasLineOfSight));
      seen = new Seen(tick, nearby);
      observations.put(npc.id(), seen);
    }
    var target =
        seen.threat()
            .filter(this::eligible)
            .filter(candidate -> !retreating(npc.id(), candidate))
            .filter(candidate -> candidate.getWorld().equals(feet.getWorld()))
            .filter(
                candidate ->
                    candidate.getLocation().distanceSquared(feet)
                        <= config.guard().detectionRadius() * config.guard().detectionRadius())
            .filter(candidate -> !(candidate instanceof Player) || wanted(candidate, feet))
            .filter(entity::hasLineOfSight);
    if (target.isPresent()) {
      var danger = target.get();
      if (guard) {
        encounters.put(npc.id(), new Encounter(danger.getUniqueId(), feet, true, Long.MAX_VALUE));
      } else {
        alert(feet, danger);
      }
    }
    return target;
  }

  void forget(String npc) {
    encounters.remove(npc);
    observations.remove(npc);
    retreated.remove(npc);
  }

  void shutdown() {
    closed = true;
    encounters.clear();
    observations.clear();
    retreated.clear();
  }

  private Optional<LivingEntity> assigned(
      String npc, Encounter encounter, Location feet, boolean guard) {
    var source = context.plugin().getServer().getEntity(encounter.target());
    if (!(source instanceof LivingEntity attacker)
        || !eligible(attacker)
        || !attacker.getWorld().equals(feet.getWorld())
        || encounter.untilTick() <= tick) {
      return Optional.empty();
    }
    if (guard && (!encounter.defend() || (attacker instanceof Player && !wanted(attacker, feet)))) {
      return Optional.empty();
    }
    var bound = guard ? config.guard().pursuitRadius() : config.guard().detectionRadius();
    var origin = guard ? encounter.origin() : feet;
    if (attacker.getLocation().distanceSquared(origin) > bound * bound
        || (guard && feet.distanceSquared(origin) > bound * bound)) {
      if (guard) {
        retreated.put(npc, attacker.getUniqueId());
        observations.remove(npc);
      }
      return Optional.empty();
    }
    return Optional.of(attacker);
  }

  /** Do not restart the same chase at a new origin while the escaped attacker stays alongside. */
  private boolean retreating(String npc, LivingEntity target) {
    return target.getUniqueId().equals(retreated.get(npc));
  }

  private void releaseRetreat(String npc, Location feet) {
    var target = retreated.get(npc);
    if (target == null) {
      return;
    }
    var source = context.plugin().getServer().getEntity(target);
    var radius = config.guard().responseRadius();
    if (!(source instanceof LivingEntity living)
        || !eligible(living)
        || !living.getWorld().equals(feet.getWorld())
        || living.getLocation().distanceSquared(feet) > radius * radius) {
      retreated.remove(npc);
    }
  }

  private void alert(Location incident, LivingEntity attacker) {
    var radius = config.guard().responseRadius();
    for (var npc : world.definitions()) {
      if (!npc.roles().contains("guard")) {
        continue;
      }
      world
          .entity(npc.id())
          .filter(LivingEntity::isValid)
          .filter(guard -> guard.getWorld().equals(incident.getWorld()))
          .filter(guard -> guard.getLocation().distanceSquared(incident) <= radius * radius)
          .filter(guard -> !retreating(npc.id(), attacker))
          .ifPresent(guard -> assignGuard(npc, attacker, incident));
    }
  }

  private void assignGuard(NpcDefinition npc, LivingEntity attacker, Location incident) {
    var previous = encounters.get(npc.id());
    if (previous != null
        && previous.defend()
        && (previous.target().equals(attacker.getUniqueId()) || !(attacker instanceof Player))) {
      return;
    }
    encounters.put(npc.id(), new Encounter(attacker.getUniqueId(), incident, true, Long.MAX_VALUE));
    observations.remove(npc.id());
    world.interrupt(npc.id());
  }

  private boolean wanted(LivingEntity entity, Location feet) {
    return entity instanceof Player player
        && ledger.isWanted(
            feet.getWorld().getKey().asString(),
            player.getUniqueId(),
            feet.getWorld().getFullTime());
  }

  private boolean eligible(LivingEntity entity) {
    return entity.isValid()
        && !entity.isDead()
        && world.npcOf(entity).isEmpty()
        && !world.isNavigator(entity)
        && (!(entity instanceof Player player) || player.getGameMode() != GameMode.SPECTATOR);
  }

  private boolean responsible(LivingEntity entity) {
    return entity instanceof Player player
        ? player.getGameMode() != GameMode.SPECTATOR
        : eligible(entity);
  }

  private boolean expire() {
    var clocks =
        context.plugin().getServer().getWorlds().stream()
            .collect(
                Collectors.toUnmodifiableMap(
                    at -> at.getKey().asString(), org.bukkit.World::getFullTime));
    if (!ledger.expire(clocks)) {
      return false;
    }
    persist();
    return true;
  }

  private void persist() {
    var _ =
        store
            .save(ledger.snapshot())
            .whenCompleteAsync(
                (done, failure) -> {
                  if (failure != null && !closed) {
                    fail(failure);
                  }
                },
                context.scheduler().mainThread());
  }

  private void fail(Throwable failure) {
    context.logger().error("NPC state persistence failed; stopping the server", failure);
    ready = false;
    context.plugin().getServer().shutdown();
  }
}

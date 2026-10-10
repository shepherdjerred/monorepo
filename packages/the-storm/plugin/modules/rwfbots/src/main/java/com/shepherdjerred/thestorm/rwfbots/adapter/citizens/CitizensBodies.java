package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import com.shepherdjerred.thestorm.rwfbots.adapter.paper.Bodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.SnapshotCapture;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.logging.Logger;
import net.citizensnpcs.api.CitizensAPI;
import net.citizensnpcs.api.event.DespawnReason;
import net.citizensnpcs.api.event.NPCDespawnEvent;
import net.citizensnpcs.api.event.NPCSpawnEvent;
import net.citizensnpcs.api.event.SpawnReason;
import net.citizensnpcs.api.npc.NPC;
import net.citizensnpcs.api.npc.NPCRegistry;
import net.citizensnpcs.trait.AttributeTrait;
import net.citizensnpcs.trait.SkinTrait;
import org.bukkit.Location;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.plugin.Plugin;

/**
 * Bot bodies as Citizens player NPCs in one in-memory registry: never saved, never counted as
 * online players, skinned from the personality's signed texture, unprotected so they take damage
 * and knockback, with Citizens' own AI off so only the bots' commands move them. The entity object
 * is replaced when the skin applies (a {@code PENDING_RESPAWN} despawn then a {@code RESPAWN}
 * spawn), so entities are resolved from the NPC on every call and the attack-speed base is
 * re-applied on every spawn. The only class in the plugin that touches Citizens. Main thread only.
 */
public final class CitizensBodies implements Bodies, Listener {

  /** The registry name; one per plugin instance. */
  public static final String REGISTRY = "rwfbots";

  /** An attack speed high enough that the 1.9 cooldown never applies to a bot's swing. */
  static final double ATTACK_SPEED = 1024;

  /** Vanilla's jump velocity. */
  static final double JUMP_VELOCITY = 0.42;

  private final NPCRegistry registry;
  private final Map<UUID, NPC> npcs = new HashMap<>();
  private final Set<UUID> known = new HashSet<>();
  private final Consumer<UUID> respawned;
  private final Logger logger;
  private int respawns;

  private CitizensBodies(NPCRegistry registry, Consumer<UUID> respawned, Logger logger) {
    this.registry = registry;
    this.respawned = respawned;
    this.logger = logger;
  }

  /**
   * Opens the registry and listens for Citizens' spawn events through {@code plugin}. Citizens must
   * be loaded; {@code respawned} hears every body whose entity was replaced.
   */
  public static CitizensBodies open(Plugin plugin, Consumer<UUID> respawned) {
    if (!CitizensAPI.hasImplementation()) {
      throw new IllegalStateException("Citizens is not loaded; rwfbots needs it for bot bodies");
    }
    var bodies =
        new CitizensBodies(
            CitizensAPI.createInMemoryNPCRegistry(REGISTRY), respawned, plugin.getLogger());
    plugin.getServer().getPluginManager().registerEvents(bodies, plugin);
    return bodies;
  }

  /** How many times a body's entity was replaced, for diagnostics. */
  public int respawns() {
    return respawns;
  }

  @Override
  public UUID create(Personality personality) {
    var npc = registry.createNPC(EntityType.PLAYER, personality.name());
    npc.setProtected(false);
    npc.setUseMinecraftAI(false);
    npc.data().set(NPC.Metadata.KNOCKBACK, true);
    npc.data().set(NPC.Metadata.SWIM, true);
    npc.data().set(NPC.Metadata.NAMEPLATE_VISIBLE, true);
    // Citizens applies its one-block default after NPCSpawnEvent unless an attribute trait owns
    // the value. Retain the ordinary player step across initial spawn and skin replacement.
    npc.getOrAddTrait(AttributeTrait.class).setAttributeValue(Attribute.STEP_HEIGHT, 0.6);
    npc.getOrAddTrait(SkinTrait.class)
        .setSkinPersistent(personality.id(), personality.skinSignature(), personality.skinValue());
    // A player NPC's entity carries Citizens' version-2 "Minecraft" UUID, not the NPC's own: rwf
    // matches every Bukkit event by the entity's UUID, so that is the bot's identity.
    var id = bodyId(npc);
    npcs.put(id, npc);
    known.add(id);
    return id;
  }

  @Override
  public void spawn(UUID bot, Location at) {
    var npc = require(bot);
    if (!npc.spawn(at, SpawnReason.PLUGIN)) {
      throw new IllegalStateException("Citizens refused to spawn " + npc.getName() + " at " + at);
    }
    entity(bot).ifPresent(CitizensBodies::attackSpeed);
  }

  @Override
  public void despawn(UUID bot) {
    var npc = npcs.remove(bot);
    if (npc == null) {
      return;
    }
    if (npc.isSpawned()) {
      npc.despawn(DespawnReason.PLUGIN);
    }
    npc.destroy();
  }

  @Override
  public Optional<Player> entity(UUID bot) {
    var npc = npcs.get(bot);
    if (npc == null || !npc.isSpawned()) {
      return Optional.empty();
    }
    return npc.getEntity() instanceof Player player ? Optional.of(player) : Optional.empty();
  }

  @Override
  public boolean isBot(UUID entity) {
    return known.contains(entity);
  }

  @Override
  public Set<UUID> living() {
    return Set.copyOf(npcs.keySet());
  }

  @Override
  public void despawnAll() {
    for (var bot : Set.copyOf(npcs.keySet())) {
      despawn(bot);
    }
  }

  @Override
  public void moveToward(UUID bot, Location target, boolean sprint) {
    var npc = require(bot);
    npc.setMoveDestination(null);
    entity(bot)
        .ifPresent(
            player -> {
              org.bukkit.entity.Entity body = player;
              var heading = target.toVector().subtract(body.getLocation().toVector());
              DoorUse.ahead(player, heading);
              steer(player, new Vec3(heading.getX(), 0, heading.getZ()), sprint);
              if (heading.getY() > 0.1 && player.isClimbing()) {
                player.setVelocity(player.getVelocity().setY(0.2));
              }
            });
  }

  @Override
  public void stop(UUID bot) {
    var npc = require(bot);
    npc.setMoveDestination(null);
    if (npc.getNavigator().isNavigating()) {
      npc.getNavigator().cancelNavigation();
    }
    entity(bot).ifPresent(player -> steer(player, Vec3.ZERO, false));
  }

  private static void steer(Player player, Vec3 heading, boolean sprint) {
    player.setSprinting(sprint);
    var velocity = player.getVelocity();
    var slowdown = player.hasActiveItem() ? 0.2 : player.isSneaking() ? 0.3 : 1.0;
    var next =
        MovementMotor.steer(
            new Vec3(velocity.getX(), velocity.getY(), velocity.getZ()),
            new MovementMotor.Control(heading, sprint, SnapshotCapture.onGround(player), slowdown));
    player.setVelocity(new org.bukkit.util.Vector(next.x(), next.y(), next.z()));
  }

  @Override
  public void look(UUID bot, float yaw, float pitch) {
    entity(bot).ifPresent(player -> player.setRotation(yaw, pitch));
  }

  @Override
  public void jump(UUID bot) {
    entity(bot)
        .filter(SnapshotCapture::onGround)
        .ifPresent(player -> player.setVelocity(player.getVelocity().setY(JUMP_VELOCITY)));
  }

  @Override
  public void sneak(UUID bot, boolean sneaking) {
    entity(bot).ifPresent(player -> player.setSneaking(sneaking));
  }

  @Override
  public void selectSlot(UUID bot, int slot) {
    entity(bot).ifPresent(player -> player.getInventory().setHeldItemSlot(slot));
  }

  @Override
  public void swing(UUID bot) {
    entity(bot).ifPresent(Player::swingMainHand);
  }

  @Override
  public void startUsing(UUID bot) {
    entity(bot).ifPresent(player -> player.startUsingItem(EquipmentSlot.HAND));
  }

  @Override
  public void stopUsing(UUID bot, boolean complete) {
    entity(bot)
        .ifPresent(
            player -> {
              if (complete) {
                player.completeUsingActiveItem();
              } else {
                player.clearActiveItem();
              }
            });
  }

  @Override
  public Optional<ActiveItem> activeItem(UUID bot) {
    return entity(bot)
        .filter(Player::hasActiveItem)
        .map(
            player ->
                new ActiveItem(player.getActiveItem().getType(), player.getActiveItemUsedTime()));
  }

  @EventHandler
  void onSpawn(NPCSpawnEvent event) {
    var npc = event.getNPC();
    if (!npcs.containsKey(bodyId(npc))) {
      return;
    }
    if (npc.getEntity() instanceof Player player) {
      attackSpeed(player);
    }
    if (event.getReason() == SpawnReason.RESPAWN) {
      respawns++;
      respawned.accept(bodyId(npc));
    }
  }

  @EventHandler
  void onDespawn(NPCDespawnEvent event) {
    // A PENDING_RESPAWN despawn is the skin landing and a DEATH despawn is a body falling in the
    // match: both expected, and the entity is re-resolved every tick. Any other despawn of a
    // living body is Citizens' doing and worth knowing about. The entity is already gone here, so
    // the module's logger reports it.
    var reason = event.getReason();
    if (reason != DespawnReason.PENDING_RESPAWN
        && reason != DespawnReason.PLUGIN
        && reason != DespawnReason.DEATH
        && npcs.containsKey(bodyId(event.getNPC()))) {
      logger.warning("rwfbots body " + event.getNPC().getName() + " despawned: " + reason);
    }
  }

  private static void attackSpeed(Player player) {
    var attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    if (attribute == null) {
      player.registerAttribute(Attribute.ATTACK_SPEED);
      attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    }
    if (attribute == null) {
      throw new IllegalStateException(
          "attack speed could not be registered on " + player.getName());
    }
    attribute.setBaseValue(ATTACK_SPEED);
  }

  /** The UUID the bot's Player entity carries, which every rwf event is keyed by. */
  static UUID bodyId(NPC npc) {
    return npc.getMinecraftUniqueId();
  }

  private NPC require(UUID bot) {
    var npc = npcs.get(bot);
    if (npc == null) {
      throw new IllegalArgumentException("no body for " + bot);
    }
    return npc;
  }
}

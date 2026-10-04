package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.npc.Skin;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler.Spawned;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.citizensnpcs.api.CitizensAPI;
import net.citizensnpcs.api.event.CitizensEnableEvent;
import net.citizensnpcs.api.npc.NPC;
import net.citizensnpcs.api.npc.NPCRegistry;
import net.citizensnpcs.npc.skin.SkinnableEntity.PlayerSkinModelType;
import net.citizensnpcs.trait.SkinTrait;
import net.citizensnpcs.trait.SleepTrait;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mannequin;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;

/** Uses upstream Citizens APIs without copying its implementation. Owns only tagged Storm NPCs. */
public final class CitizensBodies implements NpcBodies, Listener {
  private static final String OWNER = "thestorm-scripted-id";
  private static final String FINGERPRINT = "thestorm-fingerprint";
  private static final String HOME = "thestorm-home";
  private final Server server;
  private final NpcKeys keys;
  private final NpcsConfig config;
  private @Nullable NPCRegistry registry;
  private @Nullable Runnable reconcile;

  public CitizensBodies(Plugin plugin, NpcKeys keys, NpcsConfig config) {
    this.server = plugin.getServer();
    this.keys = keys;
    this.config = config;
    server.getPluginManager().registerEvents(this, plugin);
  }

  @Override
  public void start(Runnable action) {
    reconcile = action;
  }

  @EventHandler
  public void onCitizensReady(CitizensEnableEvent event) {
    registry = CitizensAPI.getNPCRegistry();
    if (reconcile == null) throw new IllegalStateException("NPC reconciliation was not installed");
    reconcile.run();
  }

  @Override
  public boolean ready() {
    return registry != null;
  }

  private NPCRegistry registry() {
    if (registry == null) throw new IllegalStateException("Citizens registry is not ready");
    return registry;
  }

  @Override
  public List<LivingEntity> all() {
    var result = new ArrayList<LivingEntity>();
    for (var npc : registry()) {
      if (npc.data().has(OWNER) && npc.isSpawned()) {
        result.add(body(npc));
      }
    }
    return List.copyOf(result);
  }

  @Override
  public LivingEntity spawn(NpcDefinition definition) {
    var npc =
        owned(definition.id())
            .orElseGet(() -> registry().createNPC(EntityType.PLAYER, definition.name()));
    npc.data().setPersistent(OWNER, definition.id());
    configure(npc, definition);
    if (!npc.isSpawned() && !npc.spawn(location(definition))) {
      throw new IllegalStateException("Citizens could not spawn " + definition.id());
    }
    var entity = body(npc);
    dress(entity, definition);
    return entity;
  }

  private Optional<NPC> owned(String id) {
    for (var npc : registry()) {
      if (id.equals(npc.data().get(OWNER))) return Optional.of(npc);
    }
    return Optional.empty();
  }

  private Location location(NpcDefinition definition) {
    var world = server.getWorld(Mannequins.requireKey(definition.home().world()));
    if (world == null) throw new IllegalStateException("NPC world is not loaded");
    return Mannequins.location(world, definition.home().position(), definition.home().rotation());
  }

  private void configure(NPC npc, NpcDefinition definition) {
    npc.setName(definition.name());
    npc.setProtected(false);
    npc.data().setPersistent(NPC.Metadata.REMOVE_FROM_PLAYERLIST, true);
    npc.data().setPersistent(NPC.Metadata.REMOVE_FROM_TABLIST, true);
    npc.data().setPersistent(NPC.Metadata.SILENT, true);
    npc.getNavigator()
        .getDefaultParameters()
        .speedModifier((float) (config.movement().speed() / 0.2))
        .range((float) config.navigator().followRange())
        .distanceMargin(config.movement().arriveDistance())
        .stationaryTicks(config.movement().stuckTicks());
    applySkin(npc, definition.skin());
  }

  private static void applySkin(NPC npc, Skin skin) {
    var trait = npc.getOrAddTrait(SkinTrait.class);
    trait.setFetchDefaultSkin(false);
    trait.setShouldUpdateSkins(false);
    switch (skin) {
      case Skin.Signed(var id, var value, var signature) ->
          trait.setSkinPersistent(id, signature, value);
      case Skin.Vanilla(var model, var name) ->
          trait.setSkinPatch(
              PlayerSkinModelType.valueOf(model.name()),
              NamespacedKey.minecraft("entity/player/" + model.id() + "/" + name),
              null,
              null);
      case Skin.Default() -> trait.clearTexture();
    }
  }

  @Override
  public void dress(LivingEntity entity, NpcDefinition definition) {
    var npc = require(entity);
    configure(npc, definition);
    npc.data().setPersistent(FINGERPRINT, definition.fingerprint());
    entity.getPersistentDataContainer().set(keys.npc(), PersistentDataType.STRING, definition.id());
    var equipment = entity.getEquipment();
    if (equipment == null) throw new IllegalStateException("NPC lacks equipment");
    equipment.setItemInMainHand(
        new ItemStack(definition.roles().contains("guard") ? Material.IRON_SWORD : Material.AIR));
    entity.addScoreboardTag("storm_scripted_npc");
    entity.addScoreboardTag("thestorm_npc_" + definition.id());
    pose(entity, definition.pose());
  }

  @Override
  public Optional<Spawned> read(Entity entity) {
    if (!ready()) return Optional.empty();
    var npc = registry().getNPC(entity);
    if (npc == null || !npc.data().has(OWNER)) return Optional.empty();
    return Optional.of(
        new Spawned(entity.getUniqueId(), npc.data().get(OWNER), npc.data().get(FINGERPRINT, "")));
  }

  @Override
  public Optional<String> savedHome(LivingEntity entity) {
    return Optional.ofNullable(require(entity).data().get(HOME));
  }

  @Override
  public void saveHome(LivingEntity entity, String home) {
    require(entity).data().setPersistent(HOME, home);
  }

  @Override
  public void remove(LivingEntity entity) {
    require(entity).destroy();
  }

  @Override
  public void navigate(LivingEntity entity, Location destination) {
    var npc = require(entity);
    var current = npc.getNavigator().getTargetAsLocation();
    if (npc.getNavigator().isNavigating()
        && current != null
        && current.getWorld().equals(destination.getWorld())
        && current.distanceSquared(destination) < 0.0001) return;
    npc.getOrAddTrait(SleepTrait.class).setSleeping(null);
    npc.getNavigator().setTarget(destination);
  }

  @Override
  public void stop(LivingEntity entity) {
    require(entity).getNavigator().cancelNavigation();
  }

  @Override
  public void face(LivingEntity entity, Location destination) {
    require(entity).faceLocation(destination);
  }

  @Override
  public void pose(LivingEntity entity, NpcPose pose) {
    var npc = require(entity);
    npc.setSneaking(pose == NpcPose.SNEAKING);
    npc.getOrAddTrait(SleepTrait.class)
        .setSleeping(pose == NpcPose.SLEEPING ? entity.getLocation() : null);
  }

  @Override
  public void removeLegacy(List<Entity> entities) {
    for (var entity : entities) {
      var data = entity.getPersistentDataContainer();
      if ((entity instanceof Mannequin && data.has(keys.npc(), PersistentDataType.STRING))
          || data.has(keys.navigator(), PersistentDataType.BYTE)) entity.remove();
    }
  }

  private NPC require(Entity entity) {
    var npc = registry().getNPC(entity);
    if (npc == null || !npc.data().has(OWNER))
      throw new IllegalStateException("not a Storm Citizens NPC");
    return npc;
  }

  private static LivingEntity body(NPC npc) {
    if (!(npc.getEntity() instanceof LivingEntity entity))
      throw new IllegalStateException("Citizens NPC has no living body");
    return entity;
  }
}

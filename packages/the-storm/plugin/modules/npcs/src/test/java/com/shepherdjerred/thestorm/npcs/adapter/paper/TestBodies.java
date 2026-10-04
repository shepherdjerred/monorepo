package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler.Spawned;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mannequin;
import org.bukkit.persistence.PersistentDataType;

/** Fake bodies for controller tests. Citizens itself is verified on the real Paper server. */
final class TestBodies implements NpcBodies {
  private final Server server;
  private final NpcKeys keys;
  private final Mannequins mannequins;

  TestBodies(Server server, NpcKeys keys) {
    this.server = server;
    this.keys = keys;
    mannequins = new Mannequins(server, keys);
  }

  @Override
  public void start(Runnable reconcile) {
    reconcile.run();
  }

  @Override
  public boolean ready() {
    return true;
  }

  @Override
  public List<LivingEntity> all() {
    return server.getWorlds().stream()
        .flatMap(world -> world.getEntitiesByClass(Mannequin.class).stream())
        .filter(entity -> read(entity).isPresent())
        .map(LivingEntity.class::cast)
        .toList();
  }

  @Override
  public LivingEntity spawn(NpcDefinition definition) {
    return mannequins.spawn(definition);
  }

  @Override
  public void dress(LivingEntity entity, NpcDefinition definition) {
    mannequins.dress((Mannequin) entity, definition);
  }

  @Override
  public Optional<Spawned> read(Entity entity) {
    return mannequins.read(entity);
  }

  @Override
  public Optional<String> savedHome(LivingEntity entity) {
    return mannequins.savedHome((Mannequin) entity);
  }

  @Override
  public void saveHome(LivingEntity entity, String home) {
    entity.getPersistentDataContainer().set(keys.home(), PersistentDataType.STRING, home);
  }

  @Override
  public void remove(LivingEntity entity) {
    entity.remove();
  }

  @Override
  public void navigate(LivingEntity entity, Location destination) {
    entity.teleport(destination);
  }

  @Override
  public void stop(LivingEntity entity) {}

  @Override
  public void face(LivingEntity entity, Location destination) {
    var at = entity.getLocation();
    at.setDirection(destination.toVector().subtract(entity.getEyeLocation().toVector()));
    entity.setRotation(at.getYaw(), at.getPitch());
  }

  @Override
  public void pose(LivingEntity entity, NpcPose pose) {
    Mannequins.pose((Mannequin) entity, pose);
  }

  @Override
  public void removeLegacy(List<Entity> entities) {}
}

package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler.Spawned;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;

/**
 * Entity and navigation boundary; production uses Citizens, tests supply server-independent bodies.
 */
public interface NpcBodies {
  /** Starts reconciliation after the body's registry is ready. */
  void start(Runnable reconcile);

  boolean ready();

  List<LivingEntity> all();

  LivingEntity spawn(NpcDefinition definition);

  void dress(LivingEntity entity, NpcDefinition definition);

  Optional<Spawned> read(Entity entity);

  Optional<String> savedHome(LivingEntity entity);

  void saveHome(LivingEntity entity, String home);

  void remove(LivingEntity entity);

  void navigate(LivingEntity entity, Location destination);

  void stop(LivingEntity entity);

  void face(LivingEntity entity, Location destination);

  void pose(LivingEntity entity, NpcPose pose);

  /** Called only after all replacements reconcile successfully. */
  void removeLegacy(List<Entity> entities);
}

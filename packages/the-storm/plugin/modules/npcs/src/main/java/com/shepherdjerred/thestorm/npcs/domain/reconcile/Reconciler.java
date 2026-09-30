package com.shepherdjerred.thestorm.npcs.domain.reconcile;

import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Matches NPC definitions with the NPC entities found in the world. Every definition ends up with
 * exactly one entity: kept if it matches, updated if its definition changed, spawned if missing.
 * Entities whose definition is gone (orphans) and extra copies (duplicates) are removed.
 */
public final class Reconciler {

  private Reconciler() {}

  /**
   * An NPC entity found in the world.
   *
   * @param entity its entity id
   * @param npc the NPC id it carries
   * @param fingerprint the {@link NpcDefinition#fingerprint()} it was last set up from
   */
  public record Spawned(UUID entity, String npc, String fingerprint) {}

  /** Why an entity is removed. */
  public enum Reason {
    /** No definition has its NPC id any more. */
    ORPHAN,
    /** Another entity already stands for its NPC. */
    DUPLICATE
  }

  /** What to do. Each list is in a stable order. */
  public record Plan(
      List<NpcDefinition> spawn, List<Assigned> update, List<Assigned> keep, List<Removal> remove) {

    public Plan {
      spawn = List.copyOf(spawn);
      update = List.copyOf(update);
      keep = List.copyOf(keep);
      remove = List.copyOf(remove);
    }
  }

  /** An entity that stays, standing for {@code definition}. */
  public record Assigned(UUID entity, NpcDefinition definition) {}

  /** An entity to remove. */
  public record Removal(UUID entity, String npc, Reason reason) {}

  public static Plan plan(Collection<NpcDefinition> definitions, Collection<Spawned> spawned) {
    var byId =
        definitions.stream()
            .sorted(Comparator.comparing(NpcDefinition::id))
            .collect(
                Collectors.toMap(
                    NpcDefinition::id,
                    Function.identity(),
                    (first, second) -> {
                      throw new IllegalArgumentException("duplicate NPC id " + first.id());
                    },
                    LinkedHashMap::new));
    var spawn = new ArrayList<NpcDefinition>();
    var update = new ArrayList<Assigned>();
    var keep = new ArrayList<Assigned>();
    var remove = new ArrayList<Removal>();
    var entitiesByNpc = group(spawned);
    entitiesByNpc.forEach(
        (npc, entities) -> {
          if (!byId.containsKey(npc)) {
            entities.forEach(
                entity -> remove.add(new Removal(entity.entity(), npc, Reason.ORPHAN)));
          }
        });
    for (var definition : byId.values()) {
      var entities = entitiesByNpc.getOrDefault(definition.id(), List.of());
      if (entities.isEmpty()) {
        spawn.add(definition);
        continue;
      }
      var fingerprint = definition.fingerprint();
      var chosen =
          entities.stream()
              .filter(entity -> entity.fingerprint().equals(fingerprint))
              .findFirst()
              .orElseGet(entities::getFirst);
      if (chosen.fingerprint().equals(fingerprint)) {
        keep.add(new Assigned(chosen.entity(), definition));
      } else {
        update.add(new Assigned(chosen.entity(), definition));
      }
      entities.stream()
          .filter(entity -> !entity.equals(chosen))
          .forEach(
              entity ->
                  remove.add(new Removal(entity.entity(), definition.id(), Reason.DUPLICATE)));
    }
    return new Plan(spawn, update, keep, remove);
  }

  private static Map<String, List<Spawned>> group(Collection<Spawned> spawned) {
    return spawned.stream()
        .sorted(Comparator.comparing(Spawned::npc).thenComparing(Spawned::entity))
        .collect(
            Collectors.groupingBy(
                Spawned::npc, LinkedHashMap::new, Collectors.toUnmodifiableList()));
  }
}

package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.app.MarkerService;
import com.shepherdjerred.thestorm.npcs.app.NpcCatalog;
import com.shepherdjerred.thestorm.npcs.domain.brain.NpcBrain;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.movement.Move;
import com.shepherdjerred.thestorm.npcs.domain.movement.Observation;
import com.shepherdjerred.thestorm.npcs.domain.movement.PathFollower;
import com.shepherdjerred.thestorm.npcs.domain.movement.Walker;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler.Spawned;
import com.shepherdjerred.thestorm.npcs.domain.schedule.TimeOfDay;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Mannequin;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * The live NPCs: one Mannequin per definition, kept in step with content and walked through the
 * day. Only NPCs in loaded chunks with a player nearby move; the rest stand still, so the per-tick
 * cost is bounded by what players can see. Main thread.
 */
final class NpcWorld {

  /** One NPC's entity and movement. */
  private static final class Live {

    NpcDefinition npc;
    Mannequin entity;
    @Nullable Walker walker;

    Live(NpcDefinition npc, Mannequin entity) {
      this.npc = npc;
      this.entity = entity;
    }
  }

  /** What a reconcile did, for logs and {@code /npc reload}. */
  record Report(int spawned, int updated, int kept, int removed) {

    @Override
    public String toString() {
      return spawned
          + " spawned, "
          + updated
          + " updated, "
          + kept
          + " unchanged, "
          + removed
          + " removed";
    }
  }

  /**
   * The Paper pieces the world drives.
   *
   * @param tickets the chunk tickets keeping NPC areas loaded
   */
  record Parts(
      Server server,
      Mannequins mannequins,
      Navigators navigators,
      ChunkTickets tickets,
      ComponentLogger logger) {}

  private final Parts parts;
  private final NpcCatalog catalog;
  private final NpcsConfig config;
  private final PathFollower follower;
  private final Map<String, Live> live = new HashMap<>();
  private @Nullable MarkerEntities displays;
  private @Nullable MarkerService markers;
  private long tick;

  NpcWorld(Parts parts, NpcCatalog catalog, NpcsConfig config, PathFollower follower) {
    this.parts = parts;
    this.catalog = catalog;
    this.config = config;
    this.follower = follower;
  }

  /** Connects the quest markers, whose displays need NPC locations from this world. */
  void attach(MarkerEntities markerDisplays, MarkerService markerService) {
    displays = markerDisplays;
    markers = markerService;
  }

  /** Where {@code npc}'s entity stands, if it is loaded. */
  Optional<Location> location(String npc) {
    var entry = live.get(npc);
    return entry != null && entry.entity.isValid()
        ? Optional.of(entry.entity.getLocation())
        : Optional.empty();
  }

  /** Where {@code npc} lives. */
  Location homeLocation(NpcDefinition npc) {
    return parts.mannequins().location(npc.home());
  }

  /** The loaded NPC id of {@code entity}, if it is one of ours. */
  Optional<NpcDefinition> npcOf(Entity entity) {
    return parts.mannequins().read(entity).flatMap(spawned -> catalog.content().npc(spawned.npc()));
  }

  /** Makes the world match the catalog: holds chunks, then spawns, updates and removes NPCs. */
  Report reconcile() {
    var content = catalog.content();
    parts.tickets().hold(content.chunks());
    var found = new HashMap<UUID, Mannequin>();
    var spawned = new ArrayList<Spawned>();
    for (var world : parts.server().getWorlds()) {
      for (var mannequin : world.getEntitiesByClass(Mannequin.class)) {
        parts
            .mannequins()
            .read(mannequin)
            .ifPresent(
                npc -> {
                  spawned.add(npc);
                  found.put(mannequin.getUniqueId(), mannequin);
                });
      }
    }
    var plan = Reconciler.plan(content.npcs().values(), spawned);
    for (var removal : plan.remove()) {
      var entity = found.get(removal.entity());
      if (entity != null) {
        entity.remove();
      }
      parts
          .logger()
          .info("Removed {} NPC entity {} ({})", removal.reason(), removal.npc(), removal.entity());
    }
    for (var npc : new HashSet<>(live.keySet())) {
      if (!content.npcs().containsKey(npc)) {
        forget(npc);
      }
    }
    for (var assigned : plan.keep()) {
      track(assigned.definition(), requireFound(found, assigned.entity()));
    }
    for (var assigned : plan.update()) {
      var entity = requireFound(found, assigned.entity());
      parts.mannequins().dress(entity, assigned.definition());
      track(assigned.definition(), entity);
    }
    for (var definition : plan.spawn()) {
      track(definition, parts.mannequins().spawn(definition));
    }
    return new Report(
        plan.spawn().size(), plan.update().size(), plan.keep().size(), plan.remove().size());
  }

  /** Entities loaded with a chunk: adopt our NPCs, drop strays and leftovers. */
  void entitiesLoaded(List<Entity> entities) {
    for (var entity : entities) {
      if (parts.navigators().isNavigator(entity)
          || (displays != null && displays.isMarker(entity))) {
        entity.remove();
        continue;
      }
      parts.mannequins().read(entity).ifPresent(spawned -> adopt((Mannequin) entity, spawned));
    }
  }

  /** Advances every nearby NPC by one tick. */
  void tick() {
    tick++;
    for (var entry : live.values()) {
      if (!entry.entity.isValid()) {
        respawnIfKilled(entry);
        continue;
      }
      animate(entry);
    }
  }

  /** Removes navigators and markers and releases chunks. The Mannequins stay: they are saved. */
  void shutdown() {
    parts.navigators().releaseAll();
    if (displays != null) {
      displays.removeAll();
    }
    parts.tickets().releaseAll();
    live.clear();
  }

  /** Every live NPC's entity, for {@code /npc tp} and {@code /npc list}. */
  Optional<Mannequin> entity(String npc) {
    var entry = live.get(npc);
    return entry == null ? Optional.empty() : Optional.of(entry.entity);
  }

  private void adopt(Mannequin entity, Spawned spawned) {
    var definition = catalog.content().npc(spawned.npc());
    if (definition.isEmpty()) {
      entity.remove();
      parts.logger().info("Removed ORPHAN NPC entity {} ({})", spawned.npc(), spawned.entity());
      return;
    }
    var entry = live.get(spawned.npc());
    if (entry != null
        && entry.entity.isValid()
        && !entry.entity.getUniqueId().equals(entity.getUniqueId())) {
      entity.remove();
      parts.logger().info("Removed DUPLICATE NPC entity {} ({})", spawned.npc(), spawned.entity());
      return;
    }
    if (!spawned.fingerprint().equals(definition.get().fingerprint())) {
      parts.mannequins().dress(entity, definition.get());
    }
    track(definition.get(), entity);
  }

  private void track(NpcDefinition npc, Mannequin entity) {
    var entry = live.get(npc.id());
    if (entry == null) {
      live.put(npc.id(), new Live(npc, entity));
    } else {
      entry.npc = npc;
      entry.entity = entity;
      entry.walker = null;
      parts.navigators().release(npc.id());
    }
    if (displays != null && markers != null) {
      // New entity or new definition: rebuild the markers above it for whoever has one.
      displays.remove(npc.id());
      markers.showNpc(npc.id(), parts.server()::getPlayer);
    }
  }

  private void forget(String npc) {
    live.remove(npc);
    parts.navigators().release(npc);
    if (displays != null) {
      displays.remove(npc);
    }
  }

  private void respawnIfKilled(Live entry) {
    if (!entry.entity.isDead()) {
      // Unloaded with its chunk; it comes back through entitiesLoaded.
      return;
    }
    var home = entry.npc.home();
    var chunk = home.chunk();
    if (parts.mannequins().world(home.world()).isChunkLoaded(chunk.x(), chunk.z())) {
      parts.navigators().release(entry.npc.id());
      track(entry.npc, parts.mannequins().spawn(entry.npc));
    }
  }

  private void animate(Live entry) {
    var feet = entry.entity.getLocation();
    var nearest = nearestPlayer(feet, config.animation().playerRadius());
    if (nearest.isEmpty()) {
      // Frozen until someone comes back; don't keep a navigator waiting meanwhile.
      parts.navigators().release(entry.npc.id());
      return;
    }
    var position = Mannequins.position(feet);
    var facing = Mannequins.facing(feet);
    var walker = entry.walker;
    if (walker == null || thinkingNow(entry.npc)) {
      var decided = decide(entry.npc, walker, feet, new PathFollower.At(position, facing));
      walker = decided.walker();
      apply(entry, decided.moves());
    }
    var npc = entry.npc;
    var path =
        walker.pathTarget().flatMap(target -> parts.navigators().find(npc.id(), feet, target));
    var watcher =
        nearest
            .filter(player -> feetOf(player).distance(feet) <= config.animation().lookRadius())
            .map(player -> Mannequins.position(player.getEyeLocation()));
    var ticked = follower.tick(walker, new Observation(tick, position, facing, path, watcher));
    entry.walker = ticked.walker();
    apply(entry, ticked.moves());
  }

  private boolean thinkingNow(NpcDefinition npc) {
    // Spread NPCs over the interval so they don't all think on the same tick.
    return Math.floorMod(tick + npc.id().hashCode(), config.animation().thinkIntervalTicks()) == 0;
  }

  private PathFollower.Tick decide(
      NpcDefinition npc, @Nullable Walker walker, Location feet, PathFollower.At at) {
    var world = feet.getWorld();
    var content = catalog.content();
    var intent =
        NpcBrain.decide(
            npc,
            content.schedule(npc),
            content.places(),
            new NpcBrain.Situation(TimeOfDay.fromWorldTicks(world.getTime()), world.hasStorm()));
    return walker == null
        ? follower.start(intent, at, tick)
        : follower.retarget(walker, intent, at, tick);
  }

  private Optional<Player> nearestPlayer(Location feet, double radius) {
    return feet.getWorld().getNearbyPlayers(feet, radius).stream()
        .min(Comparator.comparingDouble(player -> feetOf(player).distanceSquared(feet)));
  }

  /** An entity's location; for a player this is Entity's, not OfflinePlayer's nullable one. */
  static Location feetOf(Entity entity) {
    return entity.getLocation();
  }

  private void apply(Live entry, List<Move> moves) {
    var entity = entry.entity;
    for (var move : moves) {
      switch (move) {
        case Move.Step(var to, var facing) -> moveTo(entry, to, facing);
        case Move.Teleport(var to, var facing) -> moveTo(entry, to, facing);
        case Move.Settle(var facing, var pose) -> {
          entity.setRotation(facing.yaw(), facing.pitch());
          Mannequins.pose(entity, pose);
        }
        case Move.Face(var facing) -> entity.setRotation(facing.yaw(), facing.pitch());
        case Move.ReleaseNavigator() -> parts.navigators().release(entry.npc.id());
      }
    }
  }

  private void moveTo(Live entry, Vec3 to, Rotation facing) {
    var target = Mannequins.location(entry.entity.getWorld(), to, facing);
    if (entry.entity.teleport(target) && displays != null) {
      displays.follow(entry.npc.id(), target);
    }
  }

  private static Mannequin requireFound(Map<UUID, Mannequin> found, UUID entity) {
    var mannequin = found.get(entity);
    if (mannequin == null) {
      throw new IllegalStateException("reconcile planned for an entity it did not find: " + entity);
    }
    return mannequin;
  }
}

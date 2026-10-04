package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.app.MarkerService;
import com.shepherdjerred.thestorm.npcs.app.NpcCatalog;
import com.shepherdjerred.thestorm.npcs.domain.brain.Intent;
import com.shepherdjerred.thestorm.npcs.domain.brain.NpcBrain;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
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
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * The live NPCs: one Citizens body per definition, kept in step with content and walked through the
 * day. Only NPCs in loaded chunks with a player nearby move; the rest stand still, so the per-tick
 * cost is bounded by what players can see. Main thread.
 */
final class NpcWorld {

  /** One NPC's entity and movement. */
  private static final class Live {

    NpcDefinition npc;
    LivingEntity entity;
    @Nullable Walker walker;
    long lastAttackTick = Long.MIN_VALUE;

    Live(NpcDefinition npc, LivingEntity entity) {
      this.npc = npc;
      this.entity = entity;
    }
  }

  /** What a reconcile did, for logs and {@code /stormnpc reload}. */
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
  record Parts(Server server, NpcBodies bodies, HeldChunks tickets, ComponentLogger logger) {}

  private final Parts parts;
  private final NpcCatalog catalog;
  private final NpcsConfig config;
  private final PathFollower follower;
  private final Map<String, Live> live = new HashMap<>();
  private @Nullable MarkerEntities displays;
  private @Nullable MarkerService markers;
  private Function<String, List<UUID>> listeners = npc -> List.of();
  private Consumer<String> closeConversations = npc -> {};
  private @Nullable NpcCombat combat;
  private long tick;
  private boolean reconciled;

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

  /** Connects conversations: an NPC someone is talking to stands still and faces them. */
  void attachListeners(Function<String, List<UUID>> talking) {
    listeners = talking;
  }

  void attachCombat(NpcCombat reactions, Consumer<String> close) {
    combat = reactions;
    closeConversations = close;
  }

  NpcCombat combat() {
    return Objects.requireNonNull(combat, "combat must be attached before NPC startup");
  }

  boolean ready() {
    return combat().ready();
  }

  List<NpcDefinition> definitions() {
    return catalog.content().sortedNpcs();
  }

  boolean isNavigator(Entity entity) {
    return false;
  }

  void interrupt(String npc) {
    var entry = live.get(npc);
    if (entry != null) {
      entry.walker = null;
    }
    if (entry != null && entry.entity.isValid()) parts.bodies().stop(entry.entity);
    closeConversations.accept(npc);
  }

  boolean available(String npc) {
    var entry = live.get(npc);
    return ready()
        && entry != null
        && entry.entity.isValid()
        && !entry.entity.isDead()
        && !combat().reacting(npc);
  }

  void reconcileWhenReady() {
    if (ready() && parts.bodies().ready()) {
      parts.logger().info("NPCs: {}", reconcile());
    }
  }

  /** Where {@code npc}'s entity stands, if it is loaded. */
  Optional<Location> location(String npc) {
    var entry = live.get(npc);
    return entry != null && entry.entity.isValid()
        ? Optional.of(entry.entity.getLocation())
        : Optional.empty();
  }

  /** Whether a player is still close enough to use an open dialogue. */
  boolean near(Player player, String npc) {
    if (!available(npc)) return false;
    var place = location(npc);
    if (place.isEmpty() || !player.getWorld().equals(place.get().getWorld())) {
      return false;
    }
    return feetOf(player).distanceSquared(place.get())
        <= config.dialog().holdRadius() * config.dialog().holdRadius();
  }

  /** Where {@code npc} lives. */
  Location homeLocation(NpcDefinition npc) {
    var home = npc.home();
    var world = parts.server().getWorld(Mannequins.requireKey(home.world()));
    if (world == null) throw new IllegalStateException("NPC world is not loaded: " + home.world());
    return Mannequins.location(world, home.position(), home.rotation());
  }

  /** The loaded NPC id of {@code entity}, if it is one of ours. */
  Optional<NpcDefinition> npcOf(Entity entity) {
    return parts.bodies().read(entity).flatMap(spawned -> catalog.content().npc(spawned.npc()));
  }

  /** Makes the world match the catalog: holds chunks, then spawns, updates and removes NPCs. */
  Report reconcile() {
    if (!ready() || !parts.bodies().ready()) {
      throw new IllegalStateException("cannot reconcile NPCs before state and Citizens are ready");
    }
    var content = catalog.content();
    parts.tickets().hold(content.chunks());
    var found = new HashMap<UUID, LivingEntity>();
    var spawned = new ArrayList<Spawned>();
    for (var mannequin : parts.bodies().all()) {
      parts
          .bodies()
          .read(mannequin)
          .ifPresent(
              npc -> {
                spawned.add(npc);
                found.put(mannequin.getUniqueId(), mannequin);
              });
    }
    var eligible =
        content.npcs().values().stream().filter(npc -> !combat().awaitingDawn(npc.id())).toList();
    var plan = Reconciler.plan(eligible, spawned);
    for (var removal : plan.remove()) {
      var entity = found.get(removal.entity());
      if (entity != null) {
        parts.bodies().remove(entity);
      }
      parts
          .logger()
          .info("Removed {} NPC entity {} ({})", removal.reason(), removal.npc(), removal.entity());
    }
    for (var npc : new HashSet<>(live.keySet())) {
      if (!content.npcs().containsKey(npc) || combat().awaitingDawn(npc)) {
        forget(npc);
      }
    }
    for (var assigned : plan.keep()) {
      track(assigned.definition(), requireFound(found, assigned.entity()));
    }
    for (var assigned : plan.update()) {
      var entity = requireFound(found, assigned.entity());
      parts.bodies().dress(entity, assigned.definition());
      track(assigned.definition(), entity);
    }
    for (var definition : plan.spawn()) {
      track(definition, parts.bodies().spawn(definition));
    }
    // Do not remove saved legacy entities until every replacement has spawned successfully.
    for (var world : parts.server().getWorlds()) parts.bodies().removeLegacy(world.getEntities());
    reconciled = true;
    return new Report(
        plan.spawn().size(), plan.update().size(), plan.keep().size(), plan.remove().size());
  }

  /** Entities loaded with a chunk: adopt our NPCs, drop strays and leftovers. */
  void entitiesLoaded(List<Entity> entities) {
    if (!ready() || !reconciled) return;
    parts.bodies().removeLegacy(entities);
    for (var entity : entities) {
      if (displays != null && displays.isMarker(entity)) {
        entity.remove();
        continue;
      }
      parts.bodies().read(entity).ifPresent(spawned -> adopt((LivingEntity) entity, spawned));
    }
  }

  /** Advances every nearby NPC by one tick. */
  void tick() {
    if (!ready()) return;
    tick++;
    combat().tick();
    for (var entry : live.values()) {
      if (!entry.entity.isValid()) {
        respawnIfKilled(entry);
        continue;
      }
      animate(entry);
    }
  }

  /** Stops Citizens navigation and releases chunks; Citizens owns the saved NPC entities. */
  void shutdown() {
    combat().shutdown();
    live.values().stream()
        .filter(entry -> entry.entity.isValid())
        .forEach(entry -> parts.bodies().stop(entry.entity));
    if (displays != null) {
      displays.removeAll();
    }
    parts.tickets().releaseAll();
    live.clear();
  }

  /** Every live NPC's entity, for {@code /npc tp} and {@code /npc list}. */
  Optional<LivingEntity> entity(String npc) {
    var entry = live.get(npc);
    return entry == null ? Optional.empty() : Optional.of(entry.entity);
  }

  private void adopt(LivingEntity entity, Spawned spawned) {
    if (combat().awaitingDawn(spawned.npc())) {
      parts.bodies().remove(entity);
      return;
    }
    var definition = catalog.content().npc(spawned.npc());
    if (definition.isEmpty()) {
      parts.bodies().remove(entity);
      parts.logger().info("Removed ORPHAN NPC entity {} ({})", spawned.npc(), spawned.entity());
      return;
    }
    var entry = live.get(spawned.npc());
    if (entry != null
        && entry.entity.isValid()
        && !entry.entity.getUniqueId().equals(entity.getUniqueId())) {
      parts.bodies().remove(entity);
      parts.logger().info("Removed DUPLICATE NPC entity {} ({})", spawned.npc(), spawned.entity());
      return;
    }
    if (!spawned.fingerprint().equals(definition.get().fingerprint())) {
      parts.bodies().dress(entity, definition.get());
    }
    track(definition.get(), entity);
  }

  private void track(NpcDefinition npc, LivingEntity entity) {
    entity.setInvulnerable(false);
    if (entity instanceof Player player) player.setGameMode(GameMode.SURVIVAL);
    var entry = live.get(npc.id());
    var previousHome =
        entry == null ? parts.bodies().savedHome(entity) : Optional.of(entry.npc.home().toString());
    if (previousHome.isPresent() && !previousHome.get().equals(npc.home().toString())) {
      parts.bodies().stop(entity);
      if (!entity.teleport(homeLocation(npc))) {
        throw new IllegalStateException("could not move NPC " + npc.id() + " to its new home");
      }
    }
    parts.bodies().saveHome(entity, npc.home().toString());
    if (entry == null) {
      live.put(npc.id(), new Live(npc, entity));
    } else {
      entry.npc = npc;
      entry.entity = entity;
      entry.walker = null;
      parts.bodies().stop(entity);
    }
    if (displays != null && markers != null) {
      // New entity or new definition: rebuild the markers above it for whoever has one.
      displays.remove(npc.id());
      markers.showNpc(npc.id(), parts.server()::getPlayer);
    }
  }

  private void forget(String npc) {
    interrupt(npc);
    combat().forget(npc);
    var removed = live.remove(npc);
    if (removed != null && removed.entity.isValid()) parts.bodies().stop(removed.entity);
    if (displays != null) {
      displays.remove(npc);
    }
  }

  void died(String npc) {
    forget(npc);
  }

  private void respawnIfKilled(Live entry) {
    if (!entry.entity.isDead() || combat().awaitingDawn(entry.npc.id())) return;
    var home = entry.npc.home();
    var chunk = home.chunk();
    if (homeLocation(entry.npc).getWorld().isChunkLoaded(chunk.x(), chunk.z())) {
      track(entry.npc, parts.bodies().spawn(entry.npc));
    }
  }

  private void animate(Live entry) {
    var feet = entry.entity.getLocation();
    var nearest = nearestPlayer(feet, config.animation().playerRadius());
    var threat = combat().threat(entry.npc, entry.entity);
    if (nearest.isEmpty() && threat.isEmpty()) {
      // Frozen until someone comes back; don't keep a navigator waiting meanwhile.
      parts.bodies().stop(entry.entity);
      return;
    }
    var position = Mannequins.position(feet);
    var facing = Mannequins.facing(feet);
    if (entry.npc.roles().contains("guard")) {
      threat.ifPresent(enemy -> repel(entry, feet, enemy));
    }
    if (!entry.entity.isValid()) return;
    if (threat.isPresent()) closeConversations.accept(entry.npc.id());
    var listener = listener(entry.npc, feet);
    if (shouldAttend(listener, threat)) {
      attend(entry, new PathFollower.At(position, facing), listener.orElseThrow());
      return;
    }
    var walker = entry.walker;
    if (shouldReconsider(walker, thinkingNow(entry.npc), threat.isPresent())) {
      var decided = decide(entry.npc, walker, feet, threat);
      walker = decided.walker();
      apply(entry, decided.moves());
    }
    var activeWalker = Objects.requireNonNull(walker, "guard decision supplies a walker");
    // The intent walker owns dwell/arrival/recovery; Citizens owns the actual route and movement.
    var path = activeWalker.pathTarget().map(target -> new Observation.Path(List.of(target), true));
    var watcher =
        nearest
            .filter(player -> feetOf(player).distance(feet) <= config.animation().lookRadius())
            .map(player -> Mannequins.position(player.getEyeLocation()));
    var ticked =
        follower.tick(activeWalker, new Observation(tick, position, facing, path, watcher));
    entry.walker = ticked.walker();
    apply(entry, ticked.moves());
    if (displays != null) displays.follow(entry.npc.id(), entry.entity.getLocation());
  }

  static boolean shouldAttend(Optional<Player> listener, Optional<? extends LivingEntity> threat) {
    return listener.isPresent() && threat.isEmpty();
  }

  static boolean shouldReconsider(@Nullable Walker walker, boolean scheduled, boolean threatened) {
    if (walker == null || scheduled) return true;
    var reacting =
        walker.intent() instanceof Intent.Pursue || walker.intent() instanceof Intent.Flee;
    return threatened != reacting;
  }

  /** The nearest player talking to {@code npc} who is still close enough to be waited for. */
  private Optional<Player> listener(NpcDefinition npc, Location feet) {
    return listeners.apply(npc.id()).stream()
        .map(parts.server()::getPlayer)
        .filter(Objects::nonNull)
        .filter(player -> feetOf(player).getWorld().equals(feet.getWorld()))
        .filter(player -> feetOf(player).distance(feet) <= config.dialog().holdRadius())
        .min(Comparator.comparingDouble(player -> feetOf(player).distanceSquared(feet)));
  }

  /**
   * Stops and faces {@code player} while they talk. A walk in progress is dropped, and planned
   * afresh from here once the conversation ends, so waiting never counts as being stuck.
   */
  private void attend(Live entry, PathFollower.At at, Player player) {
    var walker = entry.walker;
    if (walker != null && walker.moving()) {
      parts.bodies().stop(entry.entity);
      entry.walker = null;
    }
    apply(entry, PathFollower.face(at, Mannequins.position(player.getEyeLocation())));
  }

  private boolean thinkingNow(NpcDefinition npc) {
    // Spread NPCs over the interval so they don't all think on the same tick.
    return Math.floorMod(tick + npc.id().hashCode(), config.animation().thinkIntervalTicks()) == 0;
  }

  private PathFollower.Tick decide(
      NpcDefinition npc, @Nullable Walker walker, Location feet, Optional<LivingEntity> threat) {
    var world = feet.getWorld();
    var at = new PathFollower.At(Mannequins.position(feet), Mannequins.facing(feet));
    var content = catalog.content();
    var intent =
        NpcBrain.decide(
            npc,
            content.schedule(npc),
            content.places(),
            new NpcBrain.Situation(
                TimeOfDay.fromWorldTicks(world.getTime()),
                world.hasStorm(),
                threat.map(
                    enemy ->
                        new Spot(
                            npc.home().world(),
                            Mannequins.position(enemy.getLocation()),
                            Mannequins.facing(enemy.getLocation()))),
                threat
                    .filter(enemy -> !npc.roles().contains("guard"))
                    .map(
                        enemy ->
                            EscapeRoutes.away(feet, enemy, config.guard().detectionRadius()))));
    return walker == null
        ? follower.start(intent, at, tick)
        : follower.retarget(walker, intent, at, tick);
  }

  private void repel(Live entry, Location feet, LivingEntity enemy) {
    var guard = config.guard();
    if (enemy.getLocation().distanceSquared(feet) > guard.attackReach() * guard.attackReach()
        || (entry.lastAttackTick != Long.MIN_VALUE
            && tick - entry.lastAttackTick < guard.cooldownTicks())) {
      return;
    }
    entry.lastAttackTick = tick;
    apply(
        entry,
        PathFollower.face(
            new PathFollower.At(Mannequins.position(feet), Mannequins.facing(feet)),
            Mannequins.position(enemy.getEyeLocation())));
    enemy.damage(guard.damage(), entry.entity);
  }

  private Optional<Player> nearestPlayer(Location feet, double radius) {
    return feet.getWorld().getNearbyPlayers(feet, radius).stream()
        .filter(com.shepherdjerred.thestorm.core.players.Humans::isHuman)
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
        case Move.Step(var to, var facing) -> {
          var walker = Objects.requireNonNull(entry.walker, "movement has a walker");
          var target = walker.pathTarget().orElse(to);
          parts.bodies().navigate(entity, Mannequins.location(entity.getWorld(), target, facing));
        }
        case Move.Teleport(var to, var facing) -> moveTo(entry, to, facing);
        case Move.Settle(var facing, var pose) -> {
          entity.setRotation(facing.yaw(), facing.pitch());
          parts.bodies().pose(entity, pose);
        }
        case Move.Face(var facing) -> entity.setRotation(facing.yaw(), facing.pitch());
        case Move.ReleaseNavigator() -> parts.bodies().stop(entity);
      }
    }
  }

  private void moveTo(Live entry, Vec3 to, Rotation facing) {
    var target = Mannequins.location(entry.entity.getWorld(), to, facing);
    if (entry.entity.teleport(target) && displays != null) {
      displays.follow(entry.npc.id(), target);
    }
  }

  private static LivingEntity requireFound(Map<UUID, LivingEntity> found, UUID entity) {
    var mannequin = found.get(entity);
    if (mannequin == null) {
      throw new IllegalStateException("reconcile planned for an entity it did not find: " + entity);
    }
    return mannequin;
  }
}

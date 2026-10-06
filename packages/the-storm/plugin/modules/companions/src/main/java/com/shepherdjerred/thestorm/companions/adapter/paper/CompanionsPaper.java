package com.shepherdjerred.thestorm.companions.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.chat.app.Subscription;
import com.shepherdjerred.thestorm.companions.adapter.coreprotect.NaturalBlockAudit;
import com.shepherdjerred.thestorm.companions.app.CompanionGate;
import com.shepherdjerred.thestorm.companions.app.CompanionState;
import com.shepherdjerred.thestorm.companions.app.CompanionStore;
import com.shepherdjerred.thestorm.companions.app.ConversationService;
import com.shepherdjerred.thestorm.companions.domain.Availability;
import com.shepherdjerred.thestorm.companions.domain.CompanionsConfig;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.citizensnpcs.api.CitizensAPI;
import net.citizensnpcs.api.event.CitizensEnableEvent;
import net.citizensnpcs.api.npc.NPC;
import net.kyori.adventure.text.Component;
import org.bukkit.World;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Availability reconciles bodies; the game tick only advances local survival simulation. */
public final class CompanionsPaper implements Listener, AutoCloseable {
  public record Parts(
      CompanionStore store,
      CompanionGate gate,
      NaturalBlockAudit audit,
      Protection protection,
      ConversationService conversation) {}

  private final ModuleContext context;
  private final CompanionsConfig config;
  private final CompanionStore store;
  private final CompanionGate gate;
  private final NaturalBlockAudit audit;
  private final Protection protection;
  private final Availability availability;
  private final NativeRecipes recipes = new NativeRecipes();
  private final Map<String, CompanionActor> actors = new HashMap<>();

  private record HeldChunk(World world, int x, int z) {}

  private final Map<String, HeldChunk> heldChunks = new HashMap<>();
  private final Set<String> changing = new HashSet<>();
  private final Set<String> paused = new HashSet<>();
  private final Cancellable simulation;
  private final Subscription chatSubscription;
  private final ConversationService conversation;
  private final Map<String, Instant> nextChat = new HashMap<>();
  private final Set<String> chatting = new HashSet<>();
  private boolean enabled;
  private boolean checking;
  private boolean closed;
  private boolean citizensReady;
  private Instant nextGateCheck = Instant.MIN;
  private int ticks;

  public CompanionsPaper(ModuleContext context, CompanionsConfig config, Parts parts) {
    this.context = context;
    this.config = config;
    this.store = parts.store();
    this.gate = parts.gate();
    this.audit = parts.audit();
    this.protection = parts.protection();
    conversation = parts.conversation();
    var lines = context.services().require(GlobalChat.class);
    chatSubscription =
        lines.subscribe(
            line -> {
              if (line.author() instanceof ChatAuthor.InGame human)
                context.scheduler().runOnMainThread(() -> converse(human.id(), line.text()));
            });
    availability =
        new Availability(
            ZoneId.of(config.timeZone()),
            LocalTime.parse(config.opens()),
            LocalTime.parse(config.closes()));
    context.plugin().getServer().getPluginManager().registerEvents(this, context.plugin());
    context
        .lifecycle()
        .registerEventHandler(LifecycleEvents.COMMANDS, event -> register(event.registrar()));
    simulation =
        context
            .scheduler()
            .repeatOnMainThread(
                Duration.ofMillis(50), Duration.ofMillis(config.thinkTicks() * 50L), this::tick);
    reconcile();
  }

  private boolean active() {
    var humans =
        (int)
            context.plugin().getServer().getOnlinePlayers().stream()
                .filter(Humans::isHuman)
                .count();
    return !closed
        && citizensReady
        && availability.active(context.time().instant(), humans, enabled);
  }

  @EventHandler
  public void onCitizensReady(CitizensEnableEvent event) {
    // Hide restored presentation until Storm's inventory journal has hydrated it.
    for (var npc : CitizensAPI.getNPCRegistry())
      if (npc.data().has(CompanionBody.OWNER) && npc.isSpawned()) npc.despawn();
    citizensReady = true;
    syncBodies();
  }

  /** Administrative/Temporal reconciliation also refreshes the managed rollout gate. */
  public void reconcile() {
    if (closed || checking) return;
    checking = true;
    var _ =
        gate.enabled()
            .whenCompleteAsync(
                (value, failure) -> {
                  checking = false;
                  nextGateCheck = context.time().instant().plusSeconds(30);
                  if (closed) return;
                  enabled = failure == null && value;
                  if (failure != null)
                    context
                        .logger()
                        .error("Companion rollout evaluation failed; gameplay suspended", failure);
                  syncBodies();
                },
                context.scheduler().mainThread());
  }

  private void tick() {
    if (closed) return;
    if (!context.time().instant().isBefore(nextGateCheck)) reconcile();
    syncBodies();
    if (!active()) return;
    actors.values().forEach(CompanionActor::tick);
    if (++ticks % 20 == 0) actors.values().forEach(CompanionActor::persist);
  }

  private void syncBodies() {
    for (var actor : java.util.List.copyOf(actors.values())) {
      if (actor.died() && !actor.busy()) {
        if (actor.npc().isSpawned()) actor.npc().despawn();
        actors.remove(actor.id());
        releaseChunk(actor.id());
      }
    }
    if (!active()) {
      for (var actor : java.util.List.copyOf(actors.values())) suspend(actor);
      return;
    }
    for (var identity : config.identities().subList(0, config.population())) {
      if (!actors.containsKey(identity.id())
          && !paused.contains(identity.id())
          && changing.add(identity.id())) spawn(identity);
    }
  }

  private record Hydration(CompanionsConfig.Identity identity, NPC npc, CompanionState state) {}

  private void spawn(CompanionsConfig.Identity identity) {
    var _ =
        store
            .load()
            .thenComposeAsync(
                saved -> hydrate(identity, Optional.ofNullable(saved.get(identity.id()))),
                context.scheduler().mainThread())
            .whenCompleteAsync(
                (ignored, error) -> {
                  changing.remove(identity.id());
                  if (error != null) {
                    releaseChunk(identity.id());
                    failure(identity.id(), error);
                  }
                },
                context.scheduler().mainThread());
  }

  private CompletableFuture<Void> hydrate(
      CompanionsConfig.Identity identity, Optional<CompanionStore.Stored> saved) {
    if (!active()) return CompletableFuture.completedFuture(null);
    if (saved.flatMap(CompanionStore.Stored::pending).isPresent())
      throw new IllegalStateException("unfinished companion world effect; inspect the journal");
    var npc = CompanionBody.obtain(identity, saved.map(row -> row.state().npcId()));
    var world = context.plugin().getServer().getWorld(config.spawnWorld());
    if (world == null) throw new IllegalStateException("companion spawn world is not loaded");
    var state =
        saved
            .map(CompanionStore.Stored::state)
            .orElseGet(
                () ->
                    CompanionBody.initial(
                        npc,
                        world.getSpawnLocation(),
                        context
                            .services()
                            .require(
                                com.shepherdjerred.thestorm.essentials.app.StarterSupplies.class),
                        context.plugin().getServer()));
    var persisted =
        saved.isEmpty()
            ? store.save(identity.id(), state)
            : CompletableFuture.<Void>completedFuture(null);
    return persisted.thenComposeAsync(
        ignored -> loadBody(new Hydration(identity, npc, state)), context.scheduler().mainThread());
  }

  private CompletableFuture<Void> loadBody(Hydration hydration) {
    if (!active()) return CompletableFuture.completedFuture(null);
    var state = hydration.state();
    var world = context.plugin().getServer().getWorld(state.position().world());
    if (world == null) throw new IllegalStateException("saved companion world is not loaded");
    var x = (int) Math.floor(state.position().x()) >> 4;
    var z = (int) Math.floor(state.position().z()) >> 4;
    return world
        .getChunkAtAsync(x, z, true)
        .thenAcceptAsync(
            chunk -> {
              if (!active()) return;
              context.services().require(ChunkTickets.class).hold(world, x, z);
              heldChunks.put(hydration.identity().id(), new HeldChunk(world, x, z));
              installBody(hydration);
            },
            context.scheduler().mainThread())
        .whenCompleteAsync(
            (ignored, failure) -> {
              if (failure != null) releaseChunk(hydration.identity().id());
            },
            context.scheduler().mainThread());
  }

  private void releaseChunk(String id) {
    var held = heldChunks.remove(id);
    if (held != null)
      context.services().require(ChunkTickets.class).release(held.world(), held.x(), held.z());
  }

  private void installBody(Hydration hydration) {
    if (!active()) {
      releaseChunk(hydration.identity().id());
      return;
    }
    CompanionBody.restore(hydration.npc(), hydration.state(), context.plugin().getServer());
    var parts =
        new CompanionActor.Parts(context, config, store, audit, protection, recipes, this::active);
    actors.put(
        hydration.identity().id(),
        new CompanionActor(parts, hydration.identity(), hydration.npc(), hydration.state()));
  }

  private void suspend(CompanionActor actor) {
    actor.npc().getNavigator().cancelNavigation();
    if (actor.busy() || !changing.add(actor.id())) return;
    if (actor.paused()) {
      actor.npc().despawn();
      actors.remove(actor.id());
      releaseChunk(actor.id());
      paused.add(actor.id());
      changing.remove(actor.id());
      return;
    }
    if (!actor.npc().isSpawned()) {
      actors.remove(actor.id());
      releaseChunk(actor.id());
      changing.remove(actor.id());
      return;
    }
    var snapshot = actor.snapshot();
    // Despawn first: native hunger, damage and item effects cannot change an offline snapshot.
    actor.npc().despawn();
    var _ =
        store
            .save(actor.id(), snapshot)
            .whenCompleteAsync(
                (ignored, error) -> {
                  actors.remove(actor.id());
                  releaseChunk(actor.id());
                  changing.remove(actor.id());
                  if (error != null) failure(actor.id(), error);
                },
                context.scheduler().mainThread());
  }

  private void failure(String id, Throwable error) {
    changing.remove(id);
    paused.add(id);
    context.logger().error("Companion {} paused; inspect its journal before recovery", id, error);
  }

  @EventHandler
  public void join(PlayerJoinEvent event) {
    if (Humans.isHuman(event.getPlayer())) reconcile();
  }

  @EventHandler
  public void quit(PlayerQuitEvent event) {
    if (Humans.isHuman(event.getPlayer())) context.scheduler().runOnMainThread(this::syncBodies);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void damage(EntityDamageByEntityEvent event) {
    var attacker =
        event.getDamager() instanceof Projectile projectile
            ? projectile.getShooter()
            : event.getDamager();
    if (!(attacker instanceof LivingEntity living)) return;
    for (var actor : actors.values())
      if (event.getEntity().equals(actor.npc().getEntity())) actor.harmed(living);
  }

  /** Put lethal native damage behind the same durable journal as inventory and world changes. */
  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  public void lethalDamage(org.bukkit.event.entity.EntityDamageEvent event) {
    if (!(event.getEntity() instanceof Player player)
        || event.getFinalDamage() < player.getHealth()) return;
    for (var actor : actors.values()) {
      if (!player.equals(actor.npc().getEntity()) || actor.replayingLethal() || actor.paused())
        continue;
      event.setCancelled(true);
      actor.queueLethal(event);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void death(PlayerDeathEvent event) {
    for (var actor : java.util.List.copyOf(actors.values())) {
      if (!event.getEntity().getUniqueId().equals(actor.npc().getMinecraftUniqueId())) continue;
      if (actor.replayingLethal()) {
        actor.died(event);
        return;
      }
      var before = actor.snapshot(event.getEntity());
      paused.add(actor.id());
      actors.remove(actor.id());
      releaseChunk(actor.id());
      // A death crossed the world boundary. Persist an unresolved journal rather than respawning
      // the pre-death inventory and duplicating the native drops after an interrupted shutdown.
      var _ =
          store
              .begin(actor.id(), before, "native death: verify drops before recovery")
              .whenCompleteAsync(
                  (ignored, error) -> {
                    if (error != null) failure(actor.id(), error);
                    else
                      context
                          .logger()
                          .warn(
                              "Companion {} died; native drops remain in the world and recovery requires journal inspection",
                              actor.id());
                  },
                  context.scheduler().mainThread());
    }
  }

  private void register(Commands commands) {
    var root =
        Commands.literal("companion")
            .then(
                Commands.literal("status")
                    .requires(
                        source -> source.getSender().hasPermission("thestorm.companions.admin"))
                    .executes(
                        command -> {
                          command
                              .getSource()
                              .getSender()
                              .sendMessage(
                                  Component.text(
                                      "Companions active="
                                          + active()
                                          + ", spawned="
                                          + actors.size()
                                          + ", paused="
                                          + paused));
                          return 1;
                        }))
            .then(
                Commands.literal("reconcile")
                    .requires(
                        source -> source.getSender().hasPermission("thestorm.companions.admin"))
                    .executes(
                        command -> {
                          reconcile();
                          command
                              .getSource()
                              .getSender()
                              .sendMessage(Component.text("Companion reconciliation requested"));
                          return 1;
                        }));
    for (var identity : config.identities()) {
      root.then(
          Commands.literal(identity.id())
              .requires(source -> source.getSender() instanceof Player)
              .then(
                  Commands.literal("follow")
                      .executes(
                          command ->
                              direct(
                                  identity.id(),
                                  (Player) command.getSource().getSender(),
                                  "follow")))
              .then(
                  Commands.literal("stop")
                      .executes(
                          command ->
                              direct(
                                  identity.id(), (Player) command.getSource().getSender(), "stop")))
              .then(
                  Commands.literal("resume")
                      .executes(
                          command ->
                              direct(
                                  identity.id(),
                                  (Player) command.getSource().getSender(),
                                  "resume"))));
    }
    commands.register(root.build(), "Companion status and nearby survival instructions");
  }

  private int direct(String id, Player player, String order) {
    var actor = actors.get(id);
    if (actor == null
        || !actor.npc().isSpawned()
        || !player.getWorld().equals(CompanionBody.player(actor.npc()).getWorld())
        || requireNonNull(player.getLocation())
                .distanceSquared(requireNonNull(CompanionBody.player(actor.npc()).getLocation()))
            > 256) {
      player.sendMessage(Component.text("That companion must be active and nearby."));
      return 0;
    }
    switch (order) {
      case "follow" -> actor.follow(player.getUniqueId());
      case "stop" -> actor.stop();
      case "resume" -> actor.resume();
      default -> throw new IllegalArgumentException("unknown order");
    }
    player.sendMessage(Component.text(actor.id() + ": " + order));
    return 1;
  }

  private void converse(UUID author, String message) {
    if (!active() || message.length() > 1000) return;
    var human = context.plugin().getServer().getPlayer(author);
    if (human == null || !Humans.isHuman(human)) return;
    for (var identity : config.identities()) converseWith(identity, human, message);
  }

  private void converseWith(CompanionsConfig.Identity identity, Player human, String message) {
    var actor = actors.get(identity.id());
    if (actor == null || !canConverse(identity, actor, message)) return;
    var player = CompanionBody.player(actor.npc());
    if (!human.getWorld().equals(player.getWorld())
        || requireNonNull(human.getLocation()).distanceSquared(requireNonNull(player.getLocation()))
            > 1024) return;
    chatting.add(identity.id());
    nextChat.put(identity.id(), context.time().instant().plusSeconds(30));
    var facts =
        "Health="
            + player.getHealth()
            + ", hunger="
            + player.getFoodLevel()
            + ", inventory="
            + NativeRecipes.stock(player);
    var _ =
        conversation
            .reply(identity, message, facts)
            .whenCompleteAsync(
                (reply, error) -> {
                  chatting.remove(identity.id());
                  if (error != null) {
                    context
                        .logger()
                        .warn(
                            "Companion {} conversation failed; survival continues",
                            identity.id(),
                            error);
                    return;
                  }
                  if (!active() || !actor.npc().isSpawned() || !human.isOnline() || reply.isEmpty())
                    return;
                  if (!context
                      .services()
                      .require(com.shepherdjerred.thestorm.chat.app.ChatService.class)
                      .permitsNpcGlobal(player.getUniqueId(), identity.name(), reply.get())) return;
                  context
                      .services()
                      .require(GlobalChat.class)
                      .broadcastExternal("NPC", identity.name(), reply.get());
                },
                context.scheduler().mainThread());
  }

  private boolean canConverse(
      CompanionsConfig.Identity identity, CompanionActor actor, String message) {
    return actor.npc().isSpawned()
        && !actor.paused()
        && !chatting.contains(identity.id())
        && !context.time().instant().isBefore(nextChat.getOrDefault(identity.id(), Instant.MIN))
        && java.util.Arrays.asList(message.toLowerCase(java.util.Locale.ROOT).split("[^a-z0-9_]"))
            .contains(identity.name().toLowerCase(java.util.Locale.ROOT));
  }

  @Override
  public void close() {
    closed = true;
    simulation.cancel();
    chatSubscription.cancel();
    HandlerList.unregisterAll(this);
    for (var actor : actors.values()) {
      actor.npc().getNavigator().cancelNavigation();
      if (actor.npc().isSpawned()) {
        if (!actor.busy() && !actor.paused()) {
          var _ =
              store
                  .save(actor.id(), actor.snapshot())
                  .whenComplete(
                      (ignored, error) -> {
                        if (error != null)
                          context
                              .logger()
                              .error("Failed to save companion {} on shutdown", actor.id(), error);
                      });
        }
        actor.npc().despawn();
      }
    }
    for (var id : java.util.List.copyOf(heldChunks.keySet())) releaseChunk(id);
    gate.close();
    conversation.close();
    audit.close();
  }
}

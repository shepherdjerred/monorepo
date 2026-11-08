package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.world.LoadedBlockEntities;
import com.shepherdjerred.thestorm.mechanics.app.StargateBook;
import com.shepherdjerred.thestorm.mechanics.app.StargateStore;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Chunk;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.ChunkLoadEvent;
import org.jspecify.annotations.Nullable;

/** Gate definitions live in signs; SQLite indexes them and owns private network membership. */
public final class WorldStargateStore implements StargateStore, Listener {
  private final ModuleContext context;
  private final StargateStore index;
  private final WorldGateData world;
  private final Map<UUID, Stargate> gates = new HashMap<>();
  private final Map<UUID, StargateNetwork> networks = new HashMap<>();
  private final Map<UUID, Stargate> legacy = new HashMap<>();
  private final com.shepherdjerred.thestorm.core.reset.AccountEpochs epochs;
  private @Nullable StargateBook book;
  private final Set<Chunk> pending = new HashSet<>();
  private final Set<org.bukkit.block.Block> deferredDefinitions = new HashSet<>();

  public WorldStargateStore(ModuleContext context, StargateStore index) {
    this.context = context;
    this.index = index;
    epochs =
        context
            .services()
            .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
            .epochs();
    world = new WorldGateData(context.plugin().getServer(), epochs);
  }

  /** Connects chunk discovery to the active gate registry. */
  public void attach(StargateBook book) {
    this.book = book;
    context
        .scheduler()
        .repeatOnMainThread(
            java.time.Duration.ofMillis(100),
            java.time.Duration.ofMillis(100),
            () -> {
              if (!book.ready()) return;
              for (var chunk : Set.copyOf(pending)) {
                pending.remove(chunk);
                if (chunk.isLoaded()) definitions(chunk).forEach(this::accept);
              }
            });
  }

  @Override
  public CompletableFuture<Snapshot> load() {
    return epochs
        .loaded()
        .thenCompose(ignored -> index.load())
        .thenApplyAsync(this::loadWorld, context.scheduler().mainThread());
  }

  private Snapshot loadWorld(Snapshot cached) {
    cached.networks().forEach(network -> networks.put(network.id(), network));
    for (var gate : cached.gates()) {
      legacy.put(gate.id(), gate);
      var block = world.block(gate);
      if (block.isEmpty()) {
        if (legacyAllowed(gate)) gates.put(gate.id(), gate);
        continue;
      }
      upgrade(gate);
      world.read(block.orElseThrow()).ifPresent(this::accept);
    }
    for (var loadedWorld : context.plugin().getServer().getWorlds())
      for (var chunk : loadedWorld.getLoadedChunks()) definitions(chunk).forEach(this::accept);
    return new Snapshot(List.copyOf(networks.values()), List.copyOf(gates.values()));
  }

  private void accept(WorldGateData.Definition definition) {
    var policy = network(definition);
    if (policy.isEmpty()) return;
    var gate = definition.gate();
    if (gate.equals(gates.get(gate.id()))) return;
    gates.put(gate.id(), gate);
    var current = book;
    if (current != null && current.ready()) {
      var _ = cache(current.recoverWorldGate(policy.orElseThrow(), gate), "recover " + gate.name());
    } else {
      var _ = cache(index.indexGate(policy.orElseThrow(), gate), "index " + gate.name());
    }
  }

  private Optional<StargateNetwork> network(WorldGateData.Definition definition) {
    var found = networks.get(definition.gate().networkId());
    if (found == null) {
      if (definition.policy() != WorldGateData.Policy.PUBLIC) {
        context
            .logger()
            .warn(
                "Gate {} requires the original {} network membership",
                definition.gate().name(),
                definition.policy());
        return Optional.empty();
      }
      found =
          new StargateNetwork(
              definition.gate().networkId(), definition.networkName(), new NetworkAccess.Public());
      networks.put(found.id(), found);
    }
    if (!found.name().equalsIgnoreCase(definition.networkName()))
      throw new IllegalStateException("world gate references a different network name");
    var actualPolicy =
        switch (found.access()) {
          case NetworkAccess.Public _ -> WorldGateData.Policy.PUBLIC;
          case NetworkAccess.Private _ -> WorldGateData.Policy.PRIVATE;
          case NetworkAccess.Town _ -> WorldGateData.Policy.TOWN;
        };
    if (actualPolicy != definition.policy())
      throw new IllegalStateException(
          "world gate network policy differs from its membership record");
    return Optional.of(found);
  }

  private List<WorldGateData.Definition> definitions(Chunk chunk) {
    // A frame or sign may straddle the arriving chunk. Retry incomplete legacy upgrades
    // after either side loads, without loading their neighbors ourselves.
    for (var gate : List.copyOf(legacy.values())) upgrade(gate);
    for (var state : context.services().require(LoadedBlockEntities.class).inChunk(chunk))
      if (world.hasDefinition(state.getBlock())) deferredDefinitions.add(state.getBlock());
    var found = new java.util.ArrayList<WorldGateData.Definition>();
    for (var block : Set.copyOf(deferredDefinitions)) {
      if (!PaperGrid.loaded(block) || !world.hasDefinition(block)) {
        deferredDefinitions.remove(block);
      } else
        world
            .read(block)
            .ifPresent(
                definition -> {
                  found.add(definition);
                  deferredDefinitions.remove(block);
                });
    }
    return List.copyOf(found);
  }

  private boolean legacyAllowed(Stargate gate) {
    var network = Optional.ofNullable(networks.get(gate.networkId())).orElseThrow();
    return epochs.current(gate.ownerId()) == 0
        && (!(network.access() instanceof NetworkAccess.Private(var owner, _))
            || epochs.current(owner) == 0);
  }

  private void upgrade(Stargate gate) {
    var block = world.block(gate);
    if (block.isEmpty()) return;
    if (world.marked(block.orElseThrow()) || !legacyAllowed(gate)) {
      legacy.remove(gate.id());
      world.read(block.orElseThrow()).ifPresent(this::accept);
      return;
    }
    var network = Optional.ofNullable(networks.get(gate.networkId())).orElseThrow();
    var grid = new PaperGrid(block.orElseThrow().getWorld());
    if (StargateIntegrity.valid(grid, gate, network, false)
        || StargateIntegrity.recoverable(grid, gate, network)) {
      world.write(gate, network);
      legacy.remove(gate.id());
      world.read(block.orElseThrow()).ifPresent(this::accept);
    }
  }

  @EventHandler
  void onLoad(ChunkLoadEvent event) {
    var current = book;
    if (current != null && current.ready()) definitions(event.getChunk()).forEach(this::accept);
    else pending.add(event.getChunk());
  }

  @Override
  public CompletableFuture<Void> createNetwork(StargateNetwork network) {
    return index
        .createNetwork(network)
        .thenRunAsync(() -> networks.put(network.id(), network), context.scheduler().mainThread());
  }

  @Override
  public CompletableFuture<Void> replaceInvitations(UUID networkId, Set<UUID> players) {
    return index.replaceInvitations(networkId, players);
  }

  @Override
  public CompletableFuture<Void> createGate(Stargate gate) {
    var network = Optional.ofNullable(networks.get(gate.networkId())).orElseThrow();
    world.write(gate, network);
    gates.put(gate.id(), gate);
    return cache(index.indexGate(network, gate), "create " + gate.name());
  }

  @Override
  public CompletableFuture<Void> indexGate(StargateNetwork network, Stargate gate) {
    world.write(gate, network);
    gates.put(gate.id(), gate);
    return cache(index.indexGate(network, gate), "index " + gate.name());
  }

  @Override
  public CompletableFuture<Void> createNetworkAndGate(StargateNetwork network, Stargate gate) {
    networks.put(network.id(), network);
    return createGate(gate);
  }

  @Override
  public CompletableFuture<Boolean> deleteGate(UUID id) {
    var gate = Optional.ofNullable(gates.get(id)).orElseThrow();
    world.remove(gate);
    gates.remove(id);
    return cache(index.deleteGate(id).thenApply(_ -> null), "remove " + gate.name())
        .thenApply(_ -> true);
  }

  @Override
  public CompletableFuture<Void> resetPlayer(UUID player) {
    for (var gate : List.copyOf(gates.values())) {
      var network = Optional.ofNullable(networks.get(gate.networkId())).orElseThrow();
      var privateOwner =
          network.access() instanceof NetworkAccess.Private(var owner, _) && owner.equals(player);
      if (gate.ownerId().equals(player) || privateOwner) {
        // The durable account epoch also revokes unloaded signs and definitions missing
        // from the disposable index. Remove loaded signs immediately as well.
        if (world.block(gate).isPresent()) world.remove(gate);
        gates.remove(gate.id());
        legacy.remove(gate.id());
      }
    }
    return index
        .resetPlayer(player)
        .thenRunAsync(
            () ->
                networks
                    .values()
                    .removeIf(
                        network ->
                            network.access() instanceof NetworkAccess.Private(var owner, _)
                                && owner.equals(player)),
            context.scheduler().mainThread());
  }

  private CompletableFuture<Void> cache(CompletableFuture<Void> write, String operation) {
    return write.exceptionally(
        error -> {
          context
              .logger()
              .error("World Stargate saved; could not {} its database index", operation, error);
          return null;
        });
  }
}

package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.mechanics.app.StargateStore;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateFrame;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;

/**
 * Real-Paper recovery assertions: native block states and sign metadata, with a disposable index.
 */
public final class WorldGatePaperProof {
  private final ModuleContext context;
  private final Index index = new Index();
  private final Stargate gate;
  private final StargateNetwork network;
  private final Block signBlock;

  private WorldGatePaperProof(ModuleContext context) {
    this.context = context;
    var world = context.plugin().getServer().getWorld("world");
    if (world == null) throw new IllegalStateException("missing proof world");
    world.getChunkAt(43, 0).setForceLoaded(true);
    world.getChunkAt(44, 0).setForceLoaded(true);
    network = new StargateNetwork(new UUID(0, 502), "Proof", new NetworkAccess.Public());
    var frame = new StargateFrame(new Pos(702, 80, 3), Direction.EAST);
    gate =
        new Stargate(
            new UUID(0, 503),
            network.id(),
            "Home",
            new UUID(0, 501),
            world.getUID(),
            new Pos(701, 82, 2),
            frame,
            null,
            false);
    for (var cell : frame.frameBlocks())
      world.getBlockAt(cell.x(), cell.y(), cell.z()).setType(Material.OBSIDIAN, false);
    for (var cell : frame.interior())
      world.getBlockAt(cell.x(), cell.y(), cell.z()).setType(Material.AIR, false);
    signBlock = world.getBlockAt(701, 82, 2);
    signBlock.setBlockData(Bukkit.createBlockData("minecraft:oak_wall_sign[facing=north]"), false);
    var sign = (Sign) signBlock.getState();
    sign.getSide(Side.FRONT).line(0, Component.text("Home"));
    sign.getSide(Side.FRONT).line(2, Component.text("Proof"));
    require(sign.update(false, false), "initial native sign");
    world
        .getBlockAt(704, 82, 2)
        .setBlockData(
            Bukkit.createBlockData("minecraft:stone_button[face=wall,facing=north]"), false);
    index.snapshot = new StargateStore.Snapshot(List.of(network), List.of(gate));
  }

  public static CompletableFuture<Void> run(ModuleContext context) {
    return new WorldGatePaperProof(context).run();
  }

  private CompletableFuture<Void> run() {
    return lateChunkUpgrade(false)
        .thenComposeAsync(ignored -> lateChunkUpgrade(true), context.scheduler().mainThread())
        .thenComposeAsync(
            ignored ->
                new WorldStargateStore(context, index)
                    .load()
                    .thenComposeAsync(
                        first -> {
                          require(
                              first.gates().equals(List.of(gate)),
                              "legacy database gate upgraded to world metadata");
                          index.empty();
                          return new WorldStargateStore(context, index).load();
                        },
                        context.scheduler().mainThread())
                    .thenComposeAsync(
                        rebuilt -> {
                          require(
                              rebuilt.gates().equals(List.of(gate)),
                              "owner and gate survived deleting the index");
                          require(
                              rebuilt.networks().equals(List.of(network)),
                              "public network reconstructed from world");
                          var sign = (Sign) signBlock.getState();
                          sign.getSide(Side.FRONT).line(0, Component.text("-Renamed-"));
                          require(sign.update(false, false), "edit native sign");
                          return new WorldStargateStore(context, index).load();
                        },
                        context.scheduler().mainThread())
                    .thenComposeAsync(
                        renamed -> {
                          var current = renamed.gates().getFirst();
                          require(
                              current.name().equals("Renamed")
                                  && current.ownerId().equals(gate.ownerId()),
                              "world name overrides stale index");
                          new WorldGateData(context.plugin().getServer()).write(gate, network);
                          index.snapshot =
                              new StargateStore.Snapshot(List.of(network), List.of(gate));
                          var store = new WorldStargateStore(context, index);
                          return store
                              .load()
                              .thenComposeAsync(
                                  _ -> store.deleteGate(gate.id()),
                                  context.scheduler().mainThread());
                        },
                        context.scheduler().mainThread())
                    .thenComposeAsync(
                        _ -> {
                          // Simulate a failed deletion that left the old cache row behind.
                          index.snapshot =
                              new StargateStore.Snapshot(List.of(network), List.of(gate));
                          return new WorldStargateStore(context, index).load();
                        },
                        context.scheduler().mainThread())
                    .thenComposeAsync(
                        removed -> {
                          require(
                              removed.gates().isEmpty(),
                              "world deletion overrides stale cache row");
                          var privateNetwork =
                              new StargateNetwork(
                                  network.id(),
                                  network.name(),
                                  new NetworkAccess.Private(gate.ownerId(), Set.of()));
                          new WorldGateData(context.plugin().getServer())
                              .write(gate, privateNetwork);
                          index.empty();
                          return new WorldStargateStore(context, index).load();
                        },
                        context.scheduler().mainThread())
                    .thenComposeAsync(
                        privateMissing -> {
                          require(
                              privateMissing.gates().isEmpty()
                                  && privateMissing.networks().isEmpty(),
                              "missing private membership never becomes public");
                          new WorldGateData(context.plugin().getServer()).write(gate, network);
                          index.empty();
                          index.failWrites = true;
                          return new WorldStargateStore(context, index).load();
                        },
                        context.scheduler().mainThread())
                    .thenComposeAsync(
                        failedIndex -> {
                          require(
                              failedIndex.gates().equals(List.of(gate)),
                              "failed cache write retains world definition");
                          return resetUnloadedDefinition();
                        },
                        context.scheduler().mainThread()),
            context.scheduler().mainThread())
        .thenComposeAsync(ignored -> networkCleanup(), context.scheduler().mainThread())
        .thenRunAsync(this::historicalAuthorityDoesNotMove, context.scheduler().mainThread())
        .thenRunAsync(
            () -> context.logger().info("WORLD_STARGATE_PAPER_PASS"),
            context.scheduler().mainThread());
  }

  private void historicalAuthorityDoesNotMove() {
    var world = signBlock.getWorld();
    var copyFrame = new StargateFrame(new Pos(718, 80, 3), Direction.EAST);
    for (var cell : copyFrame.frameBlocks())
      world.getBlockAt(cell.x(), cell.y(), cell.z()).setType(Material.OBSIDIAN, false);
    for (var cell : copyFrame.interior())
      world.getBlockAt(cell.x(), cell.y(), cell.z()).setType(Material.AIR, false);
    world
        .getBlockAt(720, 82, 2)
        .setBlockData(
            Bukkit.createBlockData("minecraft:stone_button[face=wall,facing=north]"), false);
    var copiedBlock = world.getBlockAt(717, 82, 2);
    copiedBlock.setBlockData(signBlock.getBlockData(), false);
    var data = new WorldGateData(context.plugin().getServer());
    data.write(gate, network);
    copySign(copiedBlock);
    require(data.read(copiedBlock).isPresent(), "ordinary copied gate retains world recovery");
    var historical =
        new Stargate(
            gate.id(),
            gate.networkId(),
            gate.name(),
            com.shepherdjerred.thestorm.core.protection.Protection.SERVER_HISTORICAL_GATE,
            gate.worldId(),
            gate.sign(),
            gate.frame(),
            null,
            false);
    data.write(historical, network);
    require(
        data.read(signBlock).isPresent(), "approved historical gate recovers at its bound site");
    copySign(copiedBlock);
    require(data.read(copiedBlock).isEmpty(), "copied historical gate cannot move its authority");
  }

  private void copySign(Block target) {
    var source = (Sign) signBlock.getState();
    var copy = (Sign) target.getState();
    for (var line = 0; line < 4; line++)
      copy.getSide(Side.FRONT).line(line, source.getSide(Side.FRONT).line(line));
    source.getPersistentDataContainer().copyTo(copy.getPersistentDataContainer(), true);
    require(copy.update(false, false), "copy native gate sign data");
  }

  private CompletableFuture<Void> lateChunkUpgrade(boolean worldOnly) {
    var world = signBlock.getWorld();
    if (worldOnly) index.empty();
    return unloadProofChunks()
        .thenComposeAsync(
            ignored -> {
              // A full force-load ticket also keeps its neighboring chunks resident. Load just
              // the sign chunk with a transient read ticket to exercise the partial frame.
              world.getChunkAt(43, 0);
              var store = new WorldStargateStore(context, index);
              var book =
                  new com.shepherdjerred.thestorm.mechanics.app.StargateBook(
                      store, context.scheduler().mainThread());
              store.attach(book);
              context
                  .plugin()
                  .getServer()
                  .getPluginManager()
                  .registerEvents(store, context.plugin());
              return book.load()
                  .thenRunAsync(
                      () -> {
                        require(
                            !world.isChunkLoaded(44, 0),
                            "startup did not force-load the frame neighbor");
                        var chunk = world.getChunkAt(44, 0);
                        chunk.setForceLoaded(true);
                        context
                            .plugin()
                            .getServer()
                            .getPluginManager()
                            .callEvent(new org.bukkit.event.world.ChunkLoadEvent(chunk, false));
                        require(
                            ((Sign) signBlock.getState(false))
                                .getPersistentDataContainer()
                                .has(
                                    new org.bukkit.NamespacedKey(
                                        "thestorm", "stargate_definition")),
                            "late frame chunk upgraded its legacy gate sign");
                        require(
                            book.registry().gate(gate.id()).filter(gate::equals).isPresent(),
                            "late frame chunk publishes the gate with or without its index");
                      },
                      context.scheduler().mainThread());
            },
            context.scheduler().mainThread());
  }

  private CompletableFuture<Void> resetUnloadedDefinition() {
    var world = signBlock.getWorld();
    index.empty();
    var epochs =
        context
            .services()
            .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
            .epochs();
    return unloadProofChunks()
        .thenCompose(ignored -> epochs.retire(gate.ownerId()))
        .thenComposeAsync(
            ignored -> {
              world.getChunkAt(43, 0).setForceLoaded(true);
              world.getChunkAt(44, 0).setForceLoaded(true);
              return new WorldStargateStore(context, index).load();
            },
            context.scheduler().mainThread())
        .thenComposeAsync(
            reset -> {
              require(
                  reset.gates().isEmpty(),
                  "reset revokes an unloaded world gate absent from the index");
              var fresh = new WorldStargateStore(context, index);
              return fresh
                  .createNetworkAndGate(network, gate)
                  .thenComposeAsync(
                      ignored -> new WorldStargateStore(context, index).load(),
                      context.scheduler().mainThread())
                  .thenAcceptAsync(
                      authored ->
                          require(
                              authored.gates().equals(List.of(gate)),
                              "explicit new authoring after reset is permitted"),
                      context.scheduler().mainThread());
            },
            context.scheduler().mainThread());
  }

  private CompletableFuture<Void> unloadProofChunks() {
    var world = signBlock.getWorld();
    world.getChunkAt(43, 0).setForceLoaded(false);
    world.getChunkAt(44, 0).setForceLoaded(false);
    // unloadChunk() itself reads the native chunk and refreshes a temporary ticket.
    // Request once, then observe residency without refreshing that ticket each tick.
    world.unloadChunkRequest(43, 0);
    world.unloadChunkRequest(44, 0);
    var completed = new CompletableFuture<Void>();
    unloadAttempt(completed, 0);
    return completed;
  }

  private CompletableFuture<Void> networkCleanup() {
    index.failWrites = false;
    var store = new WorldStargateStore(context, index);
    var capture =
        new StargateNetwork(
            new UUID(0, 504),
            "cap-1234567890",
            new NetworkAccess.Private(gate.ownerId(), Set.of()));
    return store
        .load()
        .thenComposeAsync(
            ignored ->
                store
                    .deleteEmptyNetwork(network.id())
                    .handle(
                        (removed, failure) -> {
                          require(
                              failure != null,
                              "a rebuildable index cannot hide existing world gates during cleanup");
                          return null;
                        }),
            context.scheduler().mainThread())
        .thenComposeAsync(ignored -> store.createNetwork(capture), context.scheduler().mainThread())
        .thenComposeAsync(
            ignored -> store.deleteEmptyNetwork(capture.id()), context.scheduler().mainThread())
        .thenComposeAsync(
            removed -> {
              require(removed, "empty capture network is removed");
              return store.load();
            },
            context.scheduler().mainThread())
        .thenAcceptAsync(
            remaining ->
                require(
                    remaining.networks().stream()
                        .noneMatch(value -> value.id().equals(capture.id())),
                    "capture cleanup removes its cached network policy"),
            context.scheduler().mainThread());
  }

  private void unloadAttempt(CompletableFuture<Void> completed, int attempt) {
    var world = signBlock.getWorld();
    if (!world.isChunkLoaded(43, 0) && !world.isChunkLoaded(44, 0)) {
      completed.complete(null);
    } else if (attempt >= 400) {
      completed.completeExceptionally(
          new IllegalStateException("Proof chunks retained a native load ticket"));
    } else
      context
          .scheduler()
          .runOnMainThreadLater(
              java.time.Duration.ofMillis(50), () -> unloadAttempt(completed, attempt + 1));
  }

  private static void require(boolean value, String assertion) {
    if (!value) throw new IllegalStateException("World gate proof failed: " + assertion);
  }

  private static final class Index implements StargateStore {
    private Snapshot snapshot = new Snapshot(List.of(), List.of());
    private boolean failWrites;

    void empty() {
      snapshot = new Snapshot(List.of(), List.of());
    }

    @Override
    public CompletableFuture<Snapshot> load() {
      return CompletableFuture.completedFuture(snapshot);
    }

    @Override
    public CompletableFuture<Void> indexGate(StargateNetwork network, Stargate gate) {
      if (failWrites)
        return CompletableFuture.failedFuture(
            new IllegalStateException("disposable index unavailable"));
      snapshot = new Snapshot(List.of(network), List.of(gate));
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<Boolean> deleteGate(UUID id) {
      empty();
      return CompletableFuture.completedFuture(true);
    }

    @Override
    public CompletableFuture<Void> createNetwork(StargateNetwork network) {
      var networks = new java.util.ArrayList<>(snapshot.networks());
      networks.add(network);
      snapshot = new Snapshot(networks, snapshot.gates());
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<Void> replaceInvitations(UUID id, Set<UUID> players) {
      throw new UnsupportedOperationException();
    }

    @Override
    public CompletableFuture<Void> createGate(Stargate gate) {
      throw new UnsupportedOperationException();
    }

    @Override
    public CompletableFuture<Void> createNetworkAndGate(StargateNetwork network, Stargate gate) {
      throw new UnsupportedOperationException();
    }

    @Override
    public CompletableFuture<Boolean> deleteEmptyNetwork(UUID id) {
      if (snapshot.gates().stream().anyMatch(value -> value.networkId().equals(id)))
        return CompletableFuture.failedFuture(
            new IllegalStateException("Network still has indexed gates"));
      var remaining = snapshot.networks().stream().filter(value -> !value.id().equals(id)).toList();
      var removed = remaining.size() != snapshot.networks().size();
      snapshot = new Snapshot(remaining, snapshot.gates());
      return CompletableFuture.completedFuture(removed);
    }

    @Override
    public CompletableFuture<Void> resetPlayer(UUID player) {
      throw new UnsupportedOperationException();
    }
  }
}

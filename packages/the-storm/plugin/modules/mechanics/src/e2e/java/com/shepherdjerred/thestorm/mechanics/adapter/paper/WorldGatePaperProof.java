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
    return new WorldStargateStore(context, index)
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
                  current.name().equals("Renamed") && current.ownerId().equals(gate.ownerId()),
                  "world name overrides stale index");
              new WorldGateData(context.plugin().getServer()).write(gate, network);
              index.snapshot = new StargateStore.Snapshot(List.of(network), List.of(gate));
              var store = new WorldStargateStore(context, index);
              return store
                  .load()
                  .thenComposeAsync(
                      _ -> store.deleteGate(gate.id()), context.scheduler().mainThread());
            },
            context.scheduler().mainThread())
        .thenComposeAsync(
            _ -> {
              // Simulate a failed deletion that left the old cache row behind.
              index.snapshot = new StargateStore.Snapshot(List.of(network), List.of(gate));
              return new WorldStargateStore(context, index).load();
            },
            context.scheduler().mainThread())
        .thenComposeAsync(
            removed -> {
              require(removed.gates().isEmpty(), "world deletion overrides stale cache row");
              var privateNetwork =
                  new StargateNetwork(
                      network.id(),
                      network.name(),
                      new NetworkAccess.Private(gate.ownerId(), Set.of()));
              new WorldGateData(context.plugin().getServer()).write(gate, privateNetwork);
              index.empty();
              return new WorldStargateStore(context, index).load();
            },
            context.scheduler().mainThread())
        .thenComposeAsync(
            privateMissing -> {
              require(
                  privateMissing.gates().isEmpty() && privateMissing.networks().isEmpty(),
                  "missing private membership never becomes public");
              new WorldGateData(context.plugin().getServer()).write(gate, network);
              index.empty();
              index.failWrites = true;
              return new WorldStargateStore(context, index).load();
            },
            context.scheduler().mainThread())
        .thenAcceptAsync(
            failedIndex -> {
              require(
                  failedIndex.gates().equals(List.of(gate)),
                  "failed cache write retains world definition");
              context.logger().info("WORLD_STARGATE_PAPER_PASS");
            },
            context.scheduler().mainThread());
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
      throw new UnsupportedOperationException();
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
    public CompletableFuture<Void> resetPlayer(UUID player) {
      throw new UnsupportedOperationException();
    }
  }
}

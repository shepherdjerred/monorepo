package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.store.SettlementStore;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.SettlementBlueprint;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.towns.app.LandRead;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.jspecify.annotations.Nullable;

/** Preview exact targets, check ownership/builds, commit a backup, then apply bounded batches. */
final class SettlementProvisioner {
  private static final Set<Material> NATURAL =
      Set.of(
          Material.AIR,
          Material.CAVE_AIR,
          Material.VOID_AIR,
          Material.STONE,
          Material.DEEPSLATE,
          Material.DIRT,
          Material.GRASS_BLOCK,
          Material.COARSE_DIRT,
          Material.PODZOL,
          Material.MYCELIUM,
          Material.SAND,
          Material.RED_SAND,
          Material.SANDSTONE,
          Material.RED_SANDSTONE,
          Material.GRAVEL,
          Material.WATER,
          Material.SNOW,
          Material.SNOW_BLOCK,
          Material.ICE,
          Material.PACKED_ICE,
          Material.BLUE_ICE,
          Material.CLAY,
          Material.TUFF,
          Material.GRANITE,
          Material.DIORITE,
          Material.ANDESITE,
          Material.COAL_ORE,
          Material.IRON_ORE,
          Material.COPPER_ORE,
          Material.GOLD_ORE,
          Material.REDSTONE_ORE,
          Material.LAPIS_ORE,
          Material.DIAMOND_ORE,
          Material.EMERALD_ORE,
          Material.SHORT_GRASS,
          Material.TALL_GRASS,
          Material.FERN,
          Material.LARGE_FERN,
          Material.DEAD_BUSH,
          Material.DANDELION,
          Material.POPPY,
          Material.MOSS_BLOCK,
          Material.MOSS_CARPET,
          Material.SEAGRASS,
          Material.TALL_SEAGRASS);
  private static final int BATCH = 2000;
  private final PaperContext context;
  private final SurvivalContent content;
  private final SettlementStore store;
  private final Services services;
  private final ChunkKeeper tickets;
  private Optional<SettlementStore.Backup> preview = Optional.empty();
  private final List<com.shepherdjerred.thestorm.arena.domain.geometry.ChunkPos> held =
      new ArrayList<>();
  private @Nullable Cancellable task;
  private boolean busy;
  private boolean stopped;

  record Ports(SettlementStore store, Services modules, ChunkKeeper tickets) {}

  SettlementProvisioner(PaperContext context, SurvivalContent content, Ports ports) {
    this.context = context;
    this.content = content;
    this.store = ports.store();
    this.services = ports.modules();
    this.tickets = ports.tickets();
  }

  private World world() {
    var world = context.server().getWorld(content.arena().world());
    if (world == null) {
      throw new IllegalStateException("Settlement world is missing");
    }
    return world;
  }

  void preview(CommandSender sender) {
    if (busy || content.enabled()) {
      Texts.error(sender, "Provision only a disabled, idle settlement.");
      return;
    }
    busy = true;
    preview = Optional.empty();
    complete(
        CompletableFuture.supplyAsync(() -> new SettlementBlueprint(content).blocks()),
        sender,
        blocks -> load(sender, () -> inspect(sender, blocks)));
  }

  private void load(CommandSender sender, Runnable next) {
    var world = world();
    var chunks = new ArrayList<>(content.arena().region().chunks());
    var exitChunk = content.arena().exit().point().block().chunk();
    if (!chunks.contains(exitChunk)) {
      chunks.add(exitChunk);
    }
    var loads =
        chunks.stream()
            .map(
                chunk ->
                    world
                        .getChunkAtAsync(chunk.x(), chunk.z(), true)
                        .thenAcceptAsync(
                            loaded -> {
                              if (stopped) {
                                return;
                              }
                              if (loaded == null) {
                                throw new IllegalStateException("Missing provision chunk");
                              }
                              tickets.keep(world, List.of(chunk));
                              held.add(chunk);
                            },
                            context.mainThread()))
            .toArray(CompletableFuture[]::new);
    var _ =
        CompletableFuture.allOf(loads)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (stopped) {
                    return;
                  }
                  if (failure != null) {
                    context.logger().error("Settlement chunk load failed", failure);
                    Texts.error(sender, "Settlement chunks could not load.");
                    release();
                    return;
                  }
                  try {
                    next.run();
                  } catch (RuntimeException error) {
                    context.logger().error("Settlement operation refused", error);
                    Texts.error(sender, "Settlement operation failed: " + error);
                    release();
                  }
                },
                context.mainThread());
  }

  private void inspect(CommandSender sender, Map<BlockPos, String> blueprint) {
    var land = services.require(LandRead.class);
    if (blueprint.size() > SettlementBlueprint.BLOCK_BUDGET) {
      throw new IllegalStateException("Blueprint exceeds its block budget");
    }
    var changes = new ArrayList<SettlementStore.Change>();
    var conflicts = new ArrayList<BlockPos>();
    var entries =
        blueprint.entrySet().stream()
            .sorted(
                Comparator.comparingInt((Map.Entry<BlockPos, String> e) -> e.getKey().x())
                    .thenComparingInt(e -> e.getKey().z())
                    .thenComparingInt(e -> e.getKey().y()))
            .iterator();
    task =
        context
            .scheduler()
            .repeatOnMainThread(
                Duration.ZERO,
                Duration.ofMillis(50),
                () -> {
                  try {
                    for (var i = 0; i < BATCH && entries.hasNext(); i++) {
                      inspectOne(entries.next(), land, changes, conflicts);
                    }
                    if (!entries.hasNext()) {
                      cancelTask();
                      if (!conflicts.isEmpty()) {
                        Texts.error(
                            sender,
                            "Site rejected: "
                                + conflicts.size()
                                + " protected or potentially built blocks. First targets: "
                                + conflicts.stream().limit(8).toList());
                      } else {
                        var token = digest(changes);
                        preview =
                            Optional.of(
                                new SettlementStore.Backup(
                                    token,
                                    content.arena().world(),
                                    changes,
                                    SettlementStore.Status.APPLYING));
                        Texts.info(
                            sender,
                            "Preview "
                                + token
                                + ": "
                                + changes.size()
                                + " block changes in "
                                + content.arena().region()
                                + ". Inspect the site visually before /settlement apply "
                                + token);
                      }
                      release();
                    }
                  } catch (RuntimeException error) {
                    failed(sender, error);
                  }
                });
  }

  void apply(CommandSender sender, String token) {
    applyPreview(sender, token);
  }

  private void inspectOne(
      Map.Entry<BlockPos, String> entry,
      LandRead land,
      List<SettlementStore.Change> changes,
      List<BlockPos> conflicts) {
    var pos = entry.getKey();
    var block = Places.block(world(), pos);
    if (!land.wilderness(content.arena().world(), pos.x(), pos.y(), pos.z())
        || !NATURAL.contains(block.getType())
        || block.getState() instanceof org.bukkit.block.TileState) {
      conflicts.add(pos);
    }
    var after = BlueprintBlock.parse(entry.getValue()).getAsString();
    var before = block.getBlockData().getAsString();
    if (!before.equals(after)) {
      changes.add(new SettlementStore.Change(pos, before, after));
    }
  }

  private void applyPreview(CommandSender sender, String token) {
    if (busy || content.enabled() || preview.filter(p -> p.token().equals(token)).isEmpty()) {
      Texts.error(sender, "Use a fresh successful preview token with the settlement disabled.");
      return;
    }
    busy = true;
    var backup = preview.orElseThrow();
    load(
        sender,
        () -> {
          validate(backup, false);
          var _ =
              store
                  .save(backup)
                  .whenCompleteAsync(
                      (ignored, failure) -> {
                        if (stopped) {
                          return;
                        }
                        if (failure != null) {
                          failed(
                              sender,
                              new IllegalStateException("Backup could not commit", failure));
                          return;
                        }
                        mutate(sender, backup, false);
                      },
                      context.mainThread());
        });
  }

  void restore(CommandSender sender, String token) {
    if (busy || content.enabled()) {
      Texts.error(sender, "Disable the settlement before restoration.");
      return;
    }
    busy = true;
    var _ =
        store
            .load(token)
            .whenCompleteAsync(
                (found, failure) -> {
                  if (stopped) {
                    return;
                  }
                  if (failure != null || found.isEmpty()) {
                    failed(
                        sender,
                        new IllegalStateException("Backup not found or could not load", failure));
                    return;
                  }
                  var backup = found.orElseThrow();
                  if (!backup.world().equals(content.arena().world())) {
                    failed(sender, new IllegalStateException("Backup belongs to another world"));
                    return;
                  }
                  load(
                      sender,
                      () -> {
                        validate(backup, true);
                        complete(
                            store.status(token, SettlementStore.Status.RESTORING),
                            sender,
                            _ -> mutate(sender, backup, true));
                      });
                },
                context.mainThread());
  }

  private void validate(SettlementStore.Backup backup, boolean restoring) {
    for (var entity : world().getEntities()) {
      if (content.arena().region().contains(Places.point(entity.getLocation()))
          && !(entity instanceof org.bukkit.entity.Item)) {
        throw new IllegalStateException(
            "Clear players, pets and entities from the exact footprint first");
      }
    }
    for (var change : backup.changes()) {
      validateChange(backup, restoring, change);
    }
  }

  private void validateChange(
      SettlementStore.Backup backup, boolean restoring, SettlementStore.Change change) {
    var land = services.require(LandRead.class);
    var pos = change.block();
    var exit = content.arena().exit().point().block();
    if (!content.arena().region().contains(pos)
        && !(pos.x() == exit.x() && pos.z() == exit.z() && Math.abs(pos.y() - exit.y()) <= 1)) {
      throw new IllegalStateException("Backup is outside the configured footprint at " + pos);
    }
    if (!land.wilderness(backup.world(), pos.x(), pos.y(), pos.z())) {
      throw new IllegalStateException("Ownership changed at " + pos);
    }
    var actual = Places.block(world(), pos).getBlockData().getAsString();
    if (!actual.equals(change.before()) && !(restoring && actual.equals(change.after()))) {
      throw new IllegalStateException("Site changed since preview at " + pos);
    }
  }

  private void mutate(CommandSender sender, SettlementStore.Backup backup, boolean restoring) {
    var entries = backup.changes().iterator();
    task =
        context
            .scheduler()
            .repeatOnMainThread(
                Duration.ZERO,
                Duration.ofMillis(50),
                () -> {
                  try {
                    for (var i = 0; i < BATCH && entries.hasNext(); i++) {
                      mutateOne(entries.next(), backup.token(), restoring);
                    }
                    if (!entries.hasNext()) {
                      cancelTask();
                      var status =
                          restoring
                              ? SettlementStore.Status.RESTORED
                              : SettlementStore.Status.APPLIED;
                      complete(
                          store.status(backup.token(), status),
                          sender,
                          _ -> {
                            Texts.info(
                                sender,
                                "Settlement "
                                    + status
                                    + ". Backup "
                                    + backup.token()
                                    + ". Placement activation is a separate repo-owned release.");
                            preview = Optional.empty();
                            release();
                          });
                    }
                  } catch (RuntimeException error) {
                    failed(sender, error);
                  }
                });
  }

  private static String digest(List<SettlementStore.Change> changes) {
    return hashChanges(changes);
  }

  private void mutateOne(SettlementStore.Change change, String token, boolean restoring) {
    var block = Places.block(world(), change.block());
    var current = block.getBlockData().getAsString();
    if (!current.equals(change.before()) && !current.equals(change.after())) {
      throw new IllegalStateException(
          "Concurrent edit at " + change.block() + "; restore with backup " + token);
    }
    block.setBlockData(
        context.server().createBlockData(restoring ? change.before() : change.after()), false);
  }

  private static String hashChanges(List<SettlementStore.Change> changes) {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      changes.forEach(
          c ->
              digest.update(
                  (c.block() + c.before() + c.after() + "\n").getBytes(StandardCharsets.UTF_8)));
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException failure) {
      throw new IllegalStateException(failure);
    }
  }

  private void failed(CommandSender sender, RuntimeException error) {
    context.logger().error("Settlement provision stopped; any committed backup is retained", error);
    Texts.error(sender, "Settlement operation failed: " + error);
    cancelTask();
    release();
  }

  private <T> void complete(
      CompletableFuture<T> future, CommandSender sender, java.util.function.Consumer<T> next) {
    var _ =
        future.whenCompleteAsync(
            (result, failure) -> {
              if (stopped) {
                return;
              }
              if (failure != null) {
                failed(
                    sender,
                    new IllegalStateException("Settlement operation could not complete", failure));
                return;
              }
              try {
                next.accept(result);
              } catch (RuntimeException error) {
                failed(sender, error);
              }
            },
            context.mainThread());
  }

  private void cancelTask() {
    if (task != null) {
      task.cancel();
      task = null;
    }
  }

  private void release() {
    tickets.release(world(), List.copyOf(held));
    held.clear();
    busy = false;
  }

  void stop() {
    stopped = true;
    cancelTask();
    release();
  }
}

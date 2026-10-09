package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.rwf.adapter.content.LoadedMap;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapSource;
import com.shepherdjerred.thestorm.rwf.adapter.paper.details.DetailsRestorer;
import com.shepherdjerred.thestorm.rwf.app.map.MapResourceRegistry;
import com.shepherdjerred.thestorm.rwf.app.map.MapRotation;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.data.type.Slab;
import org.jspecify.annotations.Nullable;

/**
 * One map in the world: its {@link Terrain} (held, verified and pasted from the schematic) and the
 * craters a match blows into it, which are restored afterwards. Main thread only.
 */
final class MapWorld implements MapRotation.Entry {

  private final PaperContext context;
  private final MapSource source;
  private final ChunkHolder chunks;
  private final MapResourceRegistry resources;
  private @Nullable LoadedMap map;
  private @Nullable Terrain terrain;
  private boolean loading;
  private boolean prepared;
  private int generation;
  private int preparations;
  private int releases;
  private final Set<BlockPos> cratered = new HashSet<>();

  MapWorld(
      PaperContext context, MapSource source, ChunkHolder chunks, MapResourceRegistry resources) {
    this.context = context;
    this.source = source;
    this.chunks = chunks;
    this.resources = resources;
  }

  LoadedMap map() {
    return Objects.requireNonNull(map, "terrain is not loaded for " + id());
  }

  @Override
  public String id() {
    return source.id();
  }

  MapDefinition definition() {
    return source.definition();
  }

  MapBlocks blocks() {
    return map().blocks();
  }

  /** Whether the terrain is pasted and verified. */
  boolean ready() {
    return prepared && !loading && terrain != null && terrain.ready();
  }

  /** Whether a paste or a verification is under way. */
  boolean busy() {
    return loading || (terrain != null && terrain.busy());
  }

  com.shepherdjerred.thestorm.rwf.app.map.MapLoading.State loadingState() {
    return new com.shepherdjerred.thestorm.rwf.app.map.MapLoading.State(
        id(),
        definition().border(),
        definition().blocksSha256(),
        map != null,
        busy(),
        ready(),
        terrain == null ? 0 : terrain.heldChunks(),
        preparations,
        releases);
  }

  boolean contains(Location location) {
    return location.getWorld().equals(context.world())
        && definition().border().contains(Places.vec(location));
  }

  /** Loads and holds the chunks, then verifies and if need be pastes the terrain. */
  @Override
  public void prepare(Consumer<Boolean> done) {
    if (busy() || terrain != null)
      throw new IllegalStateException(id() + " is already prepared or loading");
    loading = true;
    preparations++;
    var request = ++generation;
    var _ =
        context
            .compute()
            .submit(source::load)
            .thenComposeAsync(loaded -> prepareLoaded(loaded, request), context.mainThread())
            .whenCompleteAsync(
                (ok, failure) -> {
                  if (request != generation) return;
                  loading = false;
                  if (failure != null) {
                    context.logger().error("Could not prepare map {}", id(), failure);
                    done.accept(false);
                  } else {
                    prepared = Boolean.TRUE.equals(ok);
                    done.accept(prepared);
                  }
                },
                context.mainThread());
  }

  private CompletableFuture<Boolean> prepareLoaded(LoadedMap loaded, int request) {
    if (request != generation) return CompletableFuture.completedFuture(false);
    map = loaded;
    var prepared =
        new Terrain(
            context,
            new Terrain.Source(id(), loaded.blocks(), definition().blocksSha256()),
            chunks);
    terrain = prepared;
    var terrainReady = new CompletableFuture<Boolean>();
    prepared.prepare(
        ok -> {
          if (!ok) terrainReady.complete(false);
          else {
            var _ =
                restoreDetails()
                    .whenComplete(
                        (restored, failure) -> {
                          if (failure != null) terrainReady.completeExceptionally(failure);
                          else terrainReady.complete(restored);
                        });
          }
        });
    return terrainReady.thenCombine(resources.prepare(definition()), (ok, _) -> ok);
  }

  /** Verifies the terrain and pastes it when it differs; {@code done} gets whether it is ready. */
  void verifyAndRepair(Consumer<Boolean> done) {
    loading = true;
    prepared = false;
    var request = generation;
    requireNonNull(terrain, "terrain is not loaded for " + id())
        .verifyAndRepair(
            cratered::clear,
            ok -> {
              if (request != generation) return;
              if (!ok) {
                loading = false;
                done.accept(false);
              } else {
                var _ =
                    restoreDetails()
                        .whenComplete(
                            (restored, failure) -> {
                              if (request != generation) return;
                              if (failure != null)
                                context
                                    .logger()
                                    .error("Could not restore details of {}", id(), failure);
                              loading = false;
                              prepared = failure == null && Boolean.TRUE.equals(restored);
                              done.accept(prepared);
                            });
              }
            });
  }

  private CompletableFuture<Boolean> restoreDetails() {
    var request = generation;
    return DetailsRestorer.restore(
        new DetailsRestorer.Target(
            context.scheduler(), context.world(), definition().border().min()),
        map().details(),
        () -> request == generation);
  }

  /**
   * Turns solid blocks within {@code radius} of {@code center} to coal and slabs to stone slabs,
   * sparing infested blocks, and remembers them for {@link #revertCraters}.
   */
  void crater(BlockPos center, int radius) {
    var border = definition().border();
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dz = -radius; dz <= radius; dz++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) {
            continue;
          }
          var pos = center.plus(dx, dy, dz);
          if (border.contains(pos)) {
            craterBlock(pos);
          }
        }
      }
    }
  }

  private void craterBlock(BlockPos pos) {
    var block = Places.block(context.world(), pos);
    var type = block.getType();
    if (type.name().startsWith("INFESTED_") || !type.isSolid()) {
      return;
    }
    if (block.getBlockData() instanceof Slab slab) {
      var stone = Material.STONE_SLAB.createBlockData();
      if (stone instanceof Slab replacement) {
        replacement.setType(slab.getType());
      }
      context.blocks().set("#storm-rwf-crater", block, stone, false);
    } else {
      context
          .blocks()
          .set("#storm-rwf-crater", block, Material.COAL_BLOCK.createBlockData(), false);
    }
    cratered.add(pos);
  }

  /** Puts every cratered block back from the schematic. */
  void revertCraters() {
    for (var pos : cratered) {
      context
          .blocks()
          .set(
              "#storm-rwf-restore",
              Places.block(context.world(), pos),
              blocks().at(pos),
              false);
    }
    cratered.clear();
  }

  int crateredBlocks() {
    return cratered.size();
  }

  /** Releases inactive terrain, navigation, and chunk tickets; a later preparation reads afresh. */
  @Override
  public void release() {
    releases++;
    generation++;
    loading = false;
    prepared = false;
    if (terrain != null) terrain.release();
    resources.release(id());
    terrain = null;
    map = null;
    cratered.clear();
  }
}

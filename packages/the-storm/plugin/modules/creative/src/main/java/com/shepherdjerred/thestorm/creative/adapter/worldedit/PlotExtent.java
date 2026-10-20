package com.shepherdjerred.thestorm.creative.adapter.worldedit;

import com.shepherdjerred.thestorm.creative.domain.PlotAccess;
import com.shepherdjerred.thestorm.creative.domain.PlotBounds;
import com.sk89q.worldedit.WorldEditException;
import com.sk89q.worldedit.entity.BaseEntity;
import com.sk89q.worldedit.entity.Entity;
import com.sk89q.worldedit.extent.Extent;
import com.sk89q.worldedit.function.operation.Operation;
import com.sk89q.worldedit.function.operation.RunContext;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.regions.Region;
import com.sk89q.worldedit.util.Location;
import com.sk89q.worldedit.world.biome.BiomeType;
import com.sk89q.worldedit.world.block.BaseBlock;
import com.sk89q.worldedit.world.block.BlockState;
import com.sk89q.worldedit.world.block.BlockStateHolder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jspecify.annotations.Nullable;

/**
 * One plot column. A block, entity, or biome outside that column drops the whole edit, including
 * changes already accepted, and nothing is written to the inner extent. {@code commit} releases the
 * player's single in-flight edit after a successful inner commit.
 */
final class PlotExtent implements Extent {

  /** The standing plot, or empty when the edit is refused, plus the world's block height. */
  record Column(Optional<PlotBounds> bounds, int minY, int maxY) {}

  private final Extent inner;
  private final Column column;
  private final Runnable release;
  private final List<Pending> blocks = new ArrayList<>();
  private final Map<BlockVector3, BiomeType> biomes = new HashMap<>();
  private final List<Entity> spawned = new ArrayList<>();
  private boolean refused;
  private boolean released;

  /** One accepted block write. Held until {@code commit} so a later refusal can drop it. */
  @FunctionalInterface
  private interface Pending {
    void apply(Extent target) throws WorldEditException;
  }

  PlotExtent(Extent inner, Column column, Runnable release) {
    this.inner = inner;
    this.column = column;
    this.release = release;
  }

  @Override
  public BlockVector3 getMinimumPoint() {
    return inner.getMinimumPoint();
  }

  @Override
  public BlockVector3 getMaximumPoint() {
    return inner.getMaximumPoint();
  }

  @Override
  public List<? extends Entity> getEntities(Region region) {
    return inner.getEntities(region);
  }

  @Override
  public List<? extends Entity> getEntities() {
    return inner.getEntities();
  }

  @Override
  public BlockState getBlock(BlockVector3 position) {
    return inner.getBlock(position);
  }

  @Override
  public BaseBlock getFullBlock(BlockVector3 position) {
    return inner.getFullBlock(position);
  }

  @Override
  public BiomeType getBiome(BlockVector3 position) {
    var pending = biomes.get(position);
    if (pending != null) {
      return pending;
    }
    return inner.getBiome(position);
  }

  @Override
  public @Nullable Entity createEntity(Location location, BaseEntity entity) {
    requireUnchecked(location.getBlockX(), location.getBlockY(), location.getBlockZ());
    if (PlotAccess.forbiddenPlacement(entity.getType().id())) {
      drop();
      throw refused("Command blocks cannot be placed here.");
    }
    var created = inner.createEntity(location, entity);
    if (created != null) {
      spawned.add(created);
    }
    return created;
  }

  @Override
  public <T extends BlockStateHolder<T>> boolean setBlock(BlockVector3 position, T block)
      throws WorldEditException {
    require(position.x(), position.y(), position.z());
    if (PlotAccess.forbiddenPlacement(block.getBlockType().id())) {
      drop();
      throw new RefusedEdit("Command blocks cannot be placed here.");
    }
    blocks.add(target -> target.setBlock(position, block));
    return true;
  }

  @Override
  public boolean setBiome(BlockVector3 position, BiomeType biome) {
    requireUnchecked(position.x(), position.y(), position.z());
    biomes.put(position, biome);
    return true;
  }

  /**
   * WorldEdit flushes once while the session is still empty, then again after the blocks are set. A
   * commit only releases the in-flight edit when it had something to write or the edit was refused.
   * An empty flush leaves the buffer open for the blocks that follow.
   */
  @Override
  public @Nullable Operation commit() {
    if (refused) {
      blocks.clear();
      biomes.clear();
      finish();
      return null;
    }
    var pendingBlocks = !blocks.isEmpty() || !biomes.isEmpty();
    try {
      flush();
      var pending = inner.commit();
      if (!pendingBlocks) {
        return pending;
      }
      if (pending == null) {
        finish();
        return null;
      }
      return new ReleaseAfter(pending, this::finish);
    } catch (RuntimeException failure) {
      finish();
      throw failure;
    }
  }

  private void flush() {
    try {
      for (var change : blocks) {
        change.apply(inner);
      }
      for (var change : biomes.entrySet()) {
        inner.setBiome(change.getKey(), change.getValue());
      }
    } catch (WorldEditException failure) {
      throw new IllegalStateException(failure.getMessage(), failure);
    }
    blocks.clear();
    biomes.clear();
  }

  private void require(int x, int y, int z) throws WorldEditException {
    var plot = column.bounds();
    if (plot.isEmpty()
        || y < column.minY()
        || y > column.maxY()
        || !plot.orElseThrow().contains(x, z)) {
      drop();
      throw new RefusedEdit("That edit leaves the plot.");
    }
  }

  /** Drops every accepted change so a later commit writes nothing. */
  private void drop() {
    refused = true;
    blocks.clear();
    biomes.clear();
    for (var entity : spawned) {
      entity.remove();
    }
    spawned.clear();
  }

  private void requireUnchecked(int x, int y, int z) {
    try {
      require(x, y, z);
    } catch (WorldEditException refused) {
      var message = refused.getMessage();
      throw refused(message == null ? "That edit leaves the plot." : message);
    }
  }

  private static IllegalStateException refused(String message) {
    return new IllegalStateException(message, new RefusedEdit(message));
  }

  private void finish() {
    if (!released) {
      released = true;
      release.run();
    }
  }

  /** Runs the inner commit, then releases the in-flight edit. */
  private static final class ReleaseAfter implements Operation {

    private @Nullable Operation pending;
    private final Runnable release;

    private ReleaseAfter(Operation pending, Runnable release) {
      this.pending = pending;
      this.release = release;
    }

    @Override
    public @Nullable Operation resume(RunContext run) throws WorldEditException {
      try {
        var current = pending;
        if (current != null) {
          pending = current.resume(run);
        }
        if (pending == null) {
          release.run();
          return null;
        }
        return this;
      } catch (RuntimeException | WorldEditException failure) {
        release.run();
        throw failure;
      }
    }

    @Override
    public void cancel() {
      var current = pending;
      pending = null;
      if (current != null) {
        current.cancel();
      }
      release.run();
    }
  }
}

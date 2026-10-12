package com.shepherdjerred.thestorm.core.world;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.function.Consumer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.block.data.BlockData;

/** Shared mutation boundary for changes that do not emit vanilla block events. */
public final class AuditedBlockChanges implements BlockChanges {
  private final Consumer<Change> record;

  public AuditedBlockChanges(Consumer<Change> record) {
    this.record = Objects.requireNonNull(record);
  }

  /** Captured states belong to this operation, independent of the caller's mutable block data. */
  public record Change(String actor, Location location, BlockData before, BlockData after) {
    public Change {
      if (actor.isBlank()
          || actor.length() > 100
          || actor.chars().anyMatch(Character::isISOControl)) {
        throw new IllegalArgumentException("A block change requires an audit actor");
      }
      location = location.clone();
      before = before.clone();
      after = after.clone();
    }
  }

  @Override
  public Prepared prepare(String actor, List<Update> updates) {
    requireMainThread();
    var pending = new ArrayList<Pending>();
    var seen = new HashSet<Location>();
    for (var update : updates) {
      var block = update.block();
      if (!seen.add(block.getLocation())) {
        throw new IllegalArgumentException("A batch requires one final state per block");
      }
      var before = block.getBlockData();
      if (!before.getAsString().equals(update.replacement().getAsString())) {
        pending.add(
            new Pending(
                update, new Change(actor, block.getLocation(), before, update.replacement())));
      }
    }
    // Refusal anywhere leaves every world block unchanged. CoreProtect's queue is not
    // transactional;
    // a refused batch can leave earlier attempted entries in its audit, so failures are surfaced.
    pending.forEach(change -> record.accept(change.change()));
    return new Batch(List.copyOf(pending));
  }

  private static void requireMainThread() {
    if (!Bukkit.isPrimaryThread()) {
      throw new IllegalStateException("Block changes require the main thread");
    }
  }

  private record Pending(Update update, Change change) {}

  private static final class Batch implements Prepared {
    private final List<Pending> pending;
    private boolean applied;

    private Batch(List<Pending> pending) {
      this.pending = pending;
    }

    @Override
    public void apply() {
      requireMainThread();
      if (applied) throw new IllegalStateException("A prepared block change can only run once");
      for (var change : pending) {
        if (!change
            .update()
            .block()
            .getBlockData()
            .getAsString()
            .equals(change.change().before().getAsString())) {
          throw new IllegalStateException("A prepared block changed before application");
        }
      }
      applied = true;
      pending.forEach(Batch::place);
    }

    private static void place(Pending change) {
      var block = change.update().block();
      var replacement = change.change().after();
      if (block.getType() != replacement.getMaterial()) {
        // Establish the new block's state (including any block entity) before its properties.
        // Physics runs only after the complete replacement data has been installed.
        block.setType(replacement.getMaterial(), false);
      }
      block.setBlockData(replacement, change.update().physics());
    }
  }
}

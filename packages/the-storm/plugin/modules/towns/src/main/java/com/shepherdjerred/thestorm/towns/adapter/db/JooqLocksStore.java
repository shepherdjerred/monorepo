package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_BLOCK;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_HISTORICAL_OWNER;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_RESTORATION;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_TRUST;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.app.LocksStore;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.jooq.DSLContext;

/**
 * Locks in SQLite. Saving a lock replaces its blocks and trusted grants in one transaction. Stored
 * values that do not parse, or a lock with no blocks, fail the load rather than being skipped.
 */
public final class JooqLocksStore implements LocksStore {

  private final StormDatabase database;

  public JooqLocksStore(StormDatabase database) {
    this.database = database;
  }

  /** Read on the writer thread, so a reload sees every write queued before it. */
  @Override
  public CompletableFuture<List<Lock>> loadAll() {
    return database.write(JooqLocksStore::load);
  }

  private static List<Lock> load(DSLContext dsl) {
    var blocks = new HashMap<UUID, Set<BlockPos>>();
    for (var row : dsl.selectFrom(TOWNS_LOCK_BLOCK).fetch()) {
      blocks
          .computeIfAbsent(UUID.fromString(row.getLockId()), id -> new HashSet<>())
          .add(new BlockPos(row.getWorld(), row.getX(), row.getY(), row.getZ()));
    }
    var trusted = new HashMap<UUID, Map<UUID, LockGrant>>();
    for (var row : dsl.selectFrom(TOWNS_LOCK_TRUST).fetch()) {
      trusted
          .computeIfAbsent(UUID.fromString(row.getLockId()), id -> new HashMap<>())
          .put(UUID.fromString(row.getPlayerId()), LockGrant.valueOf(row.getGrantLevel()));
    }
    var historicalOwners = new HashMap<UUID, Map<UUID, String>>();
    for (var row : dsl.selectFrom(TOWNS_LOCK_HISTORICAL_OWNER).fetch()) {
      historicalOwners
          .computeIfAbsent(UUID.fromString(row.getLockId()), id -> new HashMap<>())
          .put(UUID.fromString(row.getPlayerId()), row.getPlayerName());
    }
    var restorations = new HashMap<UUID, Lock.Restoration>();
    for (var row : dsl.selectFrom(TOWNS_LOCK_RESTORATION).fetch()) {
      var id = UUID.fromString(row.getLockId());
      var restored =
          new Lock.Restoration(
              UUID.fromString(row.getRequestId()),
              row.getHoldingId(),
              historicalOwners.getOrDefault(id, Map.of()));
      if (!restored.imported()) {
        throw new IllegalStateException("stored restoration has no request");
      }
      restorations.put(id, restored);
    }
    if (!restorations.keySet().containsAll(historicalOwners.keySet())) {
      throw new IllegalStateException("historical owners have no restoration provenance");
    }
    return dsl.selectFrom(TOWNS_LOCK)
        .orderBy(TOWNS_LOCK.ID)
        .fetch(
            row -> {
              var id = UUID.fromString(row.getId());
              return new Lock(
                  id,
                  UUID.fromString(row.getOwnerId()),
                  blocks.getOrDefault(id, Set.of()),
                  trusted.getOrDefault(id, Map.of()),
                  new Lock.Options(row.getSharedWithTown() == 1, row.getRedstone() == 1),
                  restorations.getOrDefault(id, Lock.Restoration.NONE));
            });
  }

  @Override
  public CompletableFuture<Void> save(Lock lock) {
    return write(
        dsl -> {
          var id = lock.id().toString();
          dsl.insertInto(TOWNS_LOCK)
              .set(TOWNS_LOCK.ID, id)
              .set(TOWNS_LOCK.OWNER_ID, lock.owner().toString())
              .set(TOWNS_LOCK.SHARED_WITH_TOWN, lock.options().sharedWithTown() ? 1 : 0)
              .set(TOWNS_LOCK.REDSTONE, lock.options().redstone() ? 1 : 0)
              .onConflict(TOWNS_LOCK.ID)
              .doUpdate()
              .set(TOWNS_LOCK.OWNER_ID, lock.owner().toString())
              .set(TOWNS_LOCK.SHARED_WITH_TOWN, lock.options().sharedWithTown() ? 1 : 0)
              .set(TOWNS_LOCK.REDSTONE, lock.options().redstone() ? 1 : 0)
              .execute();
          dsl.deleteFrom(TOWNS_LOCK_BLOCK).where(TOWNS_LOCK_BLOCK.LOCK_ID.eq(id)).execute();
          dsl.deleteFrom(TOWNS_LOCK_TRUST).where(TOWNS_LOCK_TRUST.LOCK_ID.eq(id)).execute();
          dsl.deleteFrom(TOWNS_LOCK_HISTORICAL_OWNER)
              .where(TOWNS_LOCK_HISTORICAL_OWNER.LOCK_ID.eq(id))
              .execute();
          dsl.deleteFrom(TOWNS_LOCK_RESTORATION)
              .where(TOWNS_LOCK_RESTORATION.LOCK_ID.eq(id))
              .execute();
          saveRestoration(dsl, lock);
          for (var block : lock.blocks()) {
            dsl.insertInto(TOWNS_LOCK_BLOCK)
                .set(TOWNS_LOCK_BLOCK.WORLD, block.world())
                .set(TOWNS_LOCK_BLOCK.X, block.x())
                .set(TOWNS_LOCK_BLOCK.Y, block.y())
                .set(TOWNS_LOCK_BLOCK.Z, block.z())
                .set(TOWNS_LOCK_BLOCK.LOCK_ID, id)
                .execute();
          }
          for (var grant : lock.trusted().entrySet()) {
            dsl.insertInto(TOWNS_LOCK_TRUST)
                .set(TOWNS_LOCK_TRUST.LOCK_ID, id)
                .set(TOWNS_LOCK_TRUST.PLAYER_ID, grant.getKey().toString())
                .set(TOWNS_LOCK_TRUST.GRANT_LEVEL, grant.getValue().name())
                .execute();
          }
        });
  }

  @Override
  public CompletableFuture<Void> delete(UUID id) {
    return write(
        dsl -> {
          var key = id.toString();
          dsl.deleteFrom(TOWNS_LOCK_HISTORICAL_OWNER)
              .where(TOWNS_LOCK_HISTORICAL_OWNER.LOCK_ID.eq(key))
              .execute();
          dsl.deleteFrom(TOWNS_LOCK_RESTORATION)
              .where(TOWNS_LOCK_RESTORATION.LOCK_ID.eq(key))
              .execute();
          dsl.deleteFrom(TOWNS_LOCK_BLOCK).where(TOWNS_LOCK_BLOCK.LOCK_ID.eq(key)).execute();
          dsl.deleteFrom(TOWNS_LOCK_TRUST).where(TOWNS_LOCK_TRUST.LOCK_ID.eq(key)).execute();
          var deleted = dsl.deleteFrom(TOWNS_LOCK).where(TOWNS_LOCK.ID.eq(key)).execute();
          if (deleted != 1) {
            throw new IllegalStateException("lock " + id + " is not stored");
          }
        });
  }

  private static void saveRestoration(DSLContext dsl, Lock lock) {
    if (!lock.restoration().imported()) {
      return;
    }
    var id = lock.id().toString();
    dsl.insertInto(TOWNS_LOCK_RESTORATION)
        .set(TOWNS_LOCK_RESTORATION.LOCK_ID, id)
        .set(TOWNS_LOCK_RESTORATION.REQUEST_ID, lock.restoration().requestId().toString())
        .set(TOWNS_LOCK_RESTORATION.HOLDING_ID, lock.restoration().holdingId())
        .execute();
    for (var historical : lock.restoration().owners().entrySet()) {
      dsl.insertInto(TOWNS_LOCK_HISTORICAL_OWNER)
          .set(TOWNS_LOCK_HISTORICAL_OWNER.LOCK_ID, id)
          .set(TOWNS_LOCK_HISTORICAL_OWNER.PLAYER_ID, historical.getKey().toString())
          .set(TOWNS_LOCK_HISTORICAL_OWNER.PLAYER_NAME, historical.getValue())
          .execute();
    }
  }

  private CompletableFuture<Void> write(Consumer<DSLContext> work) {
    return database
        .write(
            dsl -> {
              work.accept(dsl);
              return Boolean.TRUE;
            })
        .thenAccept(done -> {});
  }
}

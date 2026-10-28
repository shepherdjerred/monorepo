package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_BLOCK;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_ENTRY;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_HISTORICAL_OWNER;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_MODE;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_RESTORATION;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_TRUST;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.adapter.db.generated.tables.records.TownsLockRecord;
import com.shepherdjerred.thestorm.towns.app.LocksStore;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import com.shepherdjerred.thestorm.towns.domain.lock.LockModes;
import com.shepherdjerred.thestorm.towns.domain.lock.LockType;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
    var groups = new HashMap<UUID, Set<String>>();
    var towns = new HashMap<UUID, Set<UUID>>();
    for (var row : dsl.selectFrom(TOWNS_LOCK_ENTRY).fetch()) {
      var id = UUID.fromString(row.getLockId());
      switch (row.getKind()) {
        case "group" ->
            groups.computeIfAbsent(id, ignored -> new HashSet<>()).add(row.getEntryKey());
        case "town" ->
            towns
                .computeIfAbsent(id, ignored -> new HashSet<>())
                .add(UUID.fromString(row.getEntryKey()));
        default -> throw new IllegalStateException("unknown lock entry " + row.getKind());
      }
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
                  options(row, groups.getOrDefault(id, Set.of()), towns.getOrDefault(id, Set.of())),
                  restorations.getOrDefault(id, Lock.Restoration.NONE));
            });
  }

  @Override
  public CompletableFuture<Void> save(Lock lock) {
    return write(dsl -> store(dsl, lock));
  }

  private static void store(DSLContext dsl, Lock lock) {
    var id = lock.id().toString();
    var options = lock.options();
    var flags = options.flags();
    dsl.insertInto(TOWNS_LOCK)
        .set(TOWNS_LOCK.ID, id)
        .set(TOWNS_LOCK.OWNER_ID, lock.owner().toString())
        .set(TOWNS_LOCK.SHARED_WITH_TOWN, bit(options.sharedWithTown()))
        .set(TOWNS_LOCK.REDSTONE, bit(options.redstone()))
        .set(TOWNS_LOCK.LOCK_TYPE, options.type().name())
        .set(TOWNS_LOCK.PASSWORD, options.password())
        .set(TOWNS_LOCK.HOPPER, bit(flags.hopper()))
        .set(TOWNS_LOCK.HOPPER_IN, bit(flags.hopperIn()))
        .set(TOWNS_LOCK.HOPPER_OUT, bit(flags.hopperOut()))
        .set(TOWNS_LOCK.GOLEM, bit(flags.golem()))
        .set(TOWNS_LOCK.MAGNET, bit(flags.magnet()))
        .set(TOWNS_LOCK.AUTOCLOSE, bit(flags.autoclose()))
        .set(TOWNS_LOCK.EXPLOSIONS, bit(flags.explosions()))
        .set(TOWNS_LOCK.EXEMPT, bit(flags.exempt()))
        .set(TOWNS_LOCK.LAST_USED, options.lastUsed().toEpochMilli())
        .onConflict(TOWNS_LOCK.ID)
        .doUpdate()
        .set(TOWNS_LOCK.OWNER_ID, lock.owner().toString())
        .set(TOWNS_LOCK.SHARED_WITH_TOWN, bit(options.sharedWithTown()))
        .set(TOWNS_LOCK.REDSTONE, bit(options.redstone()))
        .set(TOWNS_LOCK.LOCK_TYPE, options.type().name())
        .set(TOWNS_LOCK.PASSWORD, options.password())
        .set(TOWNS_LOCK.HOPPER, bit(flags.hopper()))
        .set(TOWNS_LOCK.HOPPER_IN, bit(flags.hopperIn()))
        .set(TOWNS_LOCK.HOPPER_OUT, bit(flags.hopperOut()))
        .set(TOWNS_LOCK.GOLEM, bit(flags.golem()))
        .set(TOWNS_LOCK.MAGNET, bit(flags.magnet()))
        .set(TOWNS_LOCK.AUTOCLOSE, bit(flags.autoclose()))
        .set(TOWNS_LOCK.EXPLOSIONS, bit(flags.explosions()))
        .set(TOWNS_LOCK.EXEMPT, bit(flags.exempt()))
        .set(TOWNS_LOCK.LAST_USED, options.lastUsed().toEpochMilli())
        .execute();
    dsl.deleteFrom(TOWNS_LOCK_BLOCK).where(TOWNS_LOCK_BLOCK.LOCK_ID.eq(id)).execute();
    dsl.deleteFrom(TOWNS_LOCK_TRUST).where(TOWNS_LOCK_TRUST.LOCK_ID.eq(id)).execute();
    dsl.deleteFrom(TOWNS_LOCK_ENTRY).where(TOWNS_LOCK_ENTRY.LOCK_ID.eq(id)).execute();
    dsl.deleteFrom(TOWNS_LOCK_HISTORICAL_OWNER)
        .where(TOWNS_LOCK_HISTORICAL_OWNER.LOCK_ID.eq(id))
        .execute();
    dsl.deleteFrom(TOWNS_LOCK_RESTORATION).where(TOWNS_LOCK_RESTORATION.LOCK_ID.eq(id)).execute();
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
    for (var group : options.groups()) {
      insertEntry(dsl, id, "group", group);
    }
    for (var town : options.towns()) {
      insertEntry(dsl, id, "town", town.toString());
    }
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
          dsl.deleteFrom(TOWNS_LOCK_ENTRY).where(TOWNS_LOCK_ENTRY.LOCK_ID.eq(key)).execute();
          var deleted = dsl.deleteFrom(TOWNS_LOCK).where(TOWNS_LOCK.ID.eq(key)).execute();
          if (deleted != 1) {
            throw new IllegalStateException("lock " + id + " is not stored");
          }
        });
  }

  @Override
  public CompletableFuture<Map<UUID, LockModes>> loadModes() {
    return database.write(
        dsl -> {
          var loaded = new HashMap<UUID, LockModes>();
          for (var row : dsl.selectFrom(TOWNS_LOCK_MODE).fetch()) {
            var template = row.getTemplateId();
            loaded.put(
                UUID.fromString(row.getPlayerId()),
                new LockModes(
                    row.getPersist() == 1,
                    row.getNolock() == 1,
                    row.getDropTransfer() == 1,
                    row.getQuiet() == 1,
                    template == null || template.isEmpty()
                        ? Optional.empty()
                        : Optional.of(UUID.fromString(template))));
          }
          return loaded;
        });
  }

  @Override
  public CompletableFuture<Void> saveMode(UUID player, LockModes modes) {
    return write(
        dsl -> {
          dsl.insertInto(TOWNS_LOCK_MODE)
              .set(TOWNS_LOCK_MODE.PLAYER_ID, player.toString())
              .set(TOWNS_LOCK_MODE.PERSIST, bit(modes.persist()))
              .set(TOWNS_LOCK_MODE.NOLOCK, bit(modes.nolock()))
              .set(TOWNS_LOCK_MODE.DROP_TRANSFER, bit(modes.dropTransfer()))
              .set(TOWNS_LOCK_MODE.QUIET, bit(modes.quiet()))
              .set(TOWNS_LOCK_MODE.TEMPLATE_ID, modes.template().map(UUID::toString).orElse(null))
              .onConflict(TOWNS_LOCK_MODE.PLAYER_ID)
              .doUpdate()
              .set(TOWNS_LOCK_MODE.PERSIST, bit(modes.persist()))
              .set(TOWNS_LOCK_MODE.NOLOCK, bit(modes.nolock()))
              .set(TOWNS_LOCK_MODE.DROP_TRANSFER, bit(modes.dropTransfer()))
              .set(TOWNS_LOCK_MODE.QUIET, bit(modes.quiet()))
              .set(TOWNS_LOCK_MODE.TEMPLATE_ID, modes.template().map(UUID::toString).orElse(null))
              .execute();
        });
  }

  private static void insertEntry(DSLContext dsl, String lockId, String kind, String key) {
    dsl.insertInto(TOWNS_LOCK_ENTRY)
        .set(TOWNS_LOCK_ENTRY.LOCK_ID, lockId)
        .set(TOWNS_LOCK_ENTRY.KIND, kind)
        .set(TOWNS_LOCK_ENTRY.ENTRY_KEY, key)
        .execute();
  }

  private static Lock.Options options(TownsLockRecord row, Set<String> groups, Set<UUID> towns) {
    return new Lock.Options(
        row.getSharedWithTown() == 1,
        row.getRedstone() == 1,
        LockType.valueOf(row.getLockType()),
        row.getPassword(),
        new Lock.Flags(
            row.getHopper() == 1,
            row.getHopperIn() == 1,
            row.getHopperOut() == 1,
            row.getGolem() == 1,
            row.getMagnet() == 1,
            row.getAutoclose() == 1,
            row.getExplosions() == 1,
            row.getExempt() == 1),
        groups,
        towns,
        Instant.ofEpochMilli(row.getLastUsed()));
  }

  private static int bit(boolean on) {
    return on ? 1 : 0;
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

package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_CLAIM;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_CLAIM_FLAG;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_CLAIM_TRUST;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_BLOCK;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_TRUST;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_MEMBER;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_TOWN;
import static java.util.stream.Collectors.toUnmodifiableSet;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.app.TownsSnapshot;
import com.shepherdjerred.thestorm.towns.app.TownsStore;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.time.Instant;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;

/**
 * Towns and claims in SQLite. Every write runs in one transaction on the database's writer thread;
 * the load reads everything in one transaction so it sees one consistent state. Stored values that
 * do not parse (an unknown role or flag, a malformed id) fail the load rather than being skipped.
 */
public final class JooqTownsStore implements TownsStore {

  private final StormDatabase database;

  public JooqTownsStore(StormDatabase database) {
    this.database = database;
  }

  /**
   * Reads everything on the writer thread, in one transaction, so the snapshot includes every write
   * queued before it and none queued after: a reload after a failed save never misses a save that
   * was still in flight.
   */
  @Override
  public CompletableFuture<TownsSnapshot> loadAll() {
    return database.write(JooqTownsStore::load);
  }

  private static TownsSnapshot load(DSLContext dsl) {
    var members = new HashMap<UUID, Map<UUID, TownRole>>();
    for (var row : dsl.selectFrom(TOWNS_MEMBER).fetch()) {
      members
          .computeIfAbsent(UUID.fromString(row.getTownId()), town -> new HashMap<>())
          .put(UUID.fromString(row.getPlayerId()), TownRole.valueOf(row.getRole()));
    }
    var towns =
        dsl.selectFrom(TOWNS_TOWN)
            .orderBy(TOWNS_TOWN.CREATED_AT, TOWNS_TOWN.ID)
            .fetch(
                row -> {
                  var id = UUID.fromString(row.getId());
                  return new Town(
                      id,
                      row.getName(),
                      Instant.ofEpochMilli(row.getCreatedAt()),
                      members.getOrDefault(id, Map.of()),
                      row.getGovernorLevel());
                });
    var flags = new HashMap<ChunkPos, Set<ClaimFlag>>();
    for (var row : dsl.selectFrom(TOWNS_CLAIM_FLAG).fetch()) {
      flags
          .computeIfAbsent(
              new ChunkPos(row.getWorld(), row.getChunkX(), row.getChunkZ()),
              chunk -> EnumSet.noneOf(ClaimFlag.class))
          .add(ClaimFlag.valueOf(row.getFlag()));
    }
    var trusted = new HashMap<ChunkPos, Set<UUID>>();
    for (var row : dsl.selectFrom(TOWNS_CLAIM_TRUST).fetch()) {
      trusted
          .computeIfAbsent(
              new ChunkPos(row.getWorld(), row.getChunkX(), row.getChunkZ()),
              chunk -> new HashSet<>())
          .add(UUID.fromString(row.getPlayerId()));
    }
    var claims =
        dsl.selectFrom(TOWNS_CLAIM)
            .orderBy(TOWNS_CLAIM.CLAIMED_AT, TOWNS_CLAIM.WORLD, TOWNS_CLAIM.CHUNK_X)
            .fetch(
                row -> {
                  var chunk = new ChunkPos(row.getWorld(), row.getChunkX(), row.getChunkZ());
                  return new Claim(
                      chunk,
                      UUID.fromString(row.getTownId()),
                      new ClaimFlags(flags.getOrDefault(chunk, Set.of())),
                      trusted.getOrDefault(chunk, Set.of()));
                });
    return new TownsSnapshot(towns, claims);
  }

  @Override
  public CompletableFuture<Void> createTown(Town town) {
    return write(
        dsl -> {
          var id = town.id().toString();
          dsl.insertInto(TOWNS_TOWN)
              .set(TOWNS_TOWN.ID, id)
              .set(TOWNS_TOWN.NAME, town.name())
              .set(TOWNS_TOWN.CREATED_AT, town.createdAt().toEpochMilli())
              .set(TOWNS_TOWN.GOVERNOR_LEVEL, town.governorLevel())
              .execute();
          insertMembers(dsl, town);
        });
  }

  /**
   * Replaces the town's row and its members. Members are deleted before they are inserted, so a
   * handover never has two owners, even for a moment.
   */
  @Override
  public CompletableFuture<Void> saveTown(Town town) {
    return write(dsl -> saveTown(dsl, town));
  }

  /** Membership and lock ownership change in the same SQLite transaction. */
  @Override
  public CompletableFuture<Set<UUID>> saveDeparture(Town town, UUID departed) {
    if (town.members().containsKey(departed)) {
      throw new IllegalArgumentException("departed player remains a town member");
    }
    return database.write(
        dsl -> {
          if (!dsl.fetchExists(
              TOWNS_MEMBER,
              TOWNS_MEMBER.TOWN_ID.eq(town.id().toString()),
              TOWNS_MEMBER.PLAYER_ID.eq(departed.toString()))) {
            throw new IllegalStateException("departed player is not a stored member of this town");
          }
          saveTown(dsl, town);
          var blocks = TOWNS_LOCK_BLOCK.as("blocks");
          var claims = TOWNS_CLAIM.as("claims");
          var onTownLand =
              DSL.selectOne()
                  .from(claims)
                  .where(claims.TOWN_ID.eq(town.id().toString()))
                  .and(claims.WORLD.eq(blocks.WORLD))
                  .and(blocks.X.ge(claims.CHUNK_X.mul(16)))
                  .and(blocks.X.lt(claims.CHUNK_X.add(1).mul(16)))
                  .and(blocks.Z.ge(claims.CHUNK_Z.mul(16)))
                  .and(blocks.Z.lt(claims.CHUNK_Z.add(1).mul(16)));
          var ownedBlock = DSL.selectOne().from(blocks).where(blocks.LOCK_ID.eq(TOWNS_LOCK.ID));
          var outsideBlock =
              DSL.selectOne()
                  .from(blocks)
                  .where(blocks.LOCK_ID.eq(TOWNS_LOCK.ID))
                  .andNotExists(onTownLand);
          var ids =
              dsl.select(TOWNS_LOCK.ID)
                  .from(TOWNS_LOCK)
                  .where(TOWNS_LOCK.OWNER_ID.eq(departed.toString()))
                  .andExists(ownedBlock)
                  .andNotExists(outsideBlock)
                  .fetchSet(TOWNS_LOCK.ID);
          if (!ids.isEmpty()) {
            dsl.update(TOWNS_LOCK)
                .set(TOWNS_LOCK.OWNER_ID, town.owner().toString())
                .where(TOWNS_LOCK.ID.in(ids))
                .execute();
            dsl.deleteFrom(TOWNS_LOCK_TRUST)
                .where(TOWNS_LOCK_TRUST.LOCK_ID.in(ids))
                .and(TOWNS_LOCK_TRUST.PLAYER_ID.eq(town.owner().toString()))
                .execute();
          }
          return ids.stream().map(UUID::fromString).collect(toUnmodifiableSet());
        });
  }

  private static void saveTown(DSLContext dsl, Town town) {
    var id = town.id().toString();
    var updated =
        dsl.update(TOWNS_TOWN)
            .set(TOWNS_TOWN.NAME, town.name())
            .set(TOWNS_TOWN.GOVERNOR_LEVEL, town.governorLevel())
            .where(TOWNS_TOWN.ID.eq(id))
            .execute();
    if (updated != 1) {
      throw new IllegalStateException("town " + town.id() + " is not stored");
    }
    dsl.deleteFrom(TOWNS_MEMBER).where(TOWNS_MEMBER.TOWN_ID.eq(id)).execute();
    insertMembers(dsl, town);
  }

  private static void insertMembers(DSLContext dsl, Town town) {
    for (var member : town.members().entrySet()) {
      dsl.insertInto(TOWNS_MEMBER)
          .set(TOWNS_MEMBER.PLAYER_ID, member.getKey().toString())
          .set(TOWNS_MEMBER.TOWN_ID, town.id().toString())
          .set(TOWNS_MEMBER.ROLE, member.getValue().name())
          .execute();
    }
  }

  @Override
  public CompletableFuture<Void> deleteTown(UUID townId) {
    return write(
        dsl -> {
          var id = townId.toString();
          dsl.deleteFrom(TOWNS_CLAIM_TRUST)
              .where(
                  DSL.row(
                          TOWNS_CLAIM_TRUST.WORLD,
                          TOWNS_CLAIM_TRUST.CHUNK_X,
                          TOWNS_CLAIM_TRUST.CHUNK_Z)
                      .in(
                          DSL.select(TOWNS_CLAIM.WORLD, TOWNS_CLAIM.CHUNK_X, TOWNS_CLAIM.CHUNK_Z)
                              .from(TOWNS_CLAIM)
                              .where(TOWNS_CLAIM.TOWN_ID.eq(id))))
              .execute();
          dsl.deleteFrom(TOWNS_CLAIM_FLAG)
              .where(
                  DSL.row(
                          TOWNS_CLAIM_FLAG.WORLD,
                          TOWNS_CLAIM_FLAG.CHUNK_X,
                          TOWNS_CLAIM_FLAG.CHUNK_Z)
                      .in(
                          DSL.select(TOWNS_CLAIM.WORLD, TOWNS_CLAIM.CHUNK_X, TOWNS_CLAIM.CHUNK_Z)
                              .from(TOWNS_CLAIM)
                              .where(TOWNS_CLAIM.TOWN_ID.eq(id))))
              .execute();
          dsl.deleteFrom(TOWNS_CLAIM).where(TOWNS_CLAIM.TOWN_ID.eq(id)).execute();
          dsl.deleteFrom(TOWNS_MEMBER).where(TOWNS_MEMBER.TOWN_ID.eq(id)).execute();
          var deleted = dsl.deleteFrom(TOWNS_TOWN).where(TOWNS_TOWN.ID.eq(id)).execute();
          if (deleted != 1) {
            throw new IllegalStateException("town " + townId + " is not stored");
          }
        });
  }

  @Override
  public CompletableFuture<Void> addClaim(Claim claim, Instant at) {
    return write(
        dsl -> {
          var chunk = claim.chunk();
          dsl.insertInto(TOWNS_CLAIM)
              .set(TOWNS_CLAIM.WORLD, chunk.world())
              .set(TOWNS_CLAIM.CHUNK_X, chunk.x())
              .set(TOWNS_CLAIM.CHUNK_Z, chunk.z())
              .set(TOWNS_CLAIM.TOWN_ID, claim.townId().toString())
              .set(TOWNS_CLAIM.CLAIMED_AT, at.toEpochMilli())
              .execute();
          insertSettings(dsl, claim);
        });
  }

  @Override
  public CompletableFuture<Void> removeClaim(ChunkPos chunk) {
    return write(
        dsl -> {
          deleteSettings(dsl, chunk);
          var deleted =
              dsl.deleteFrom(TOWNS_CLAIM)
                  .where(
                      TOWNS_CLAIM.WORLD.eq(chunk.world()),
                      TOWNS_CLAIM.CHUNK_X.eq(chunk.x()),
                      TOWNS_CLAIM.CHUNK_Z.eq(chunk.z()))
                  .execute();
          if (deleted != 1) {
            throw new IllegalStateException("claim " + chunk + " is not stored");
          }
        });
  }

  @Override
  public CompletableFuture<Void> saveClaim(Claim claim) {
    return write(
        dsl -> {
          var chunk = claim.chunk();
          var stored =
              dsl.fetchExists(
                  TOWNS_CLAIM,
                  TOWNS_CLAIM.WORLD.eq(chunk.world()),
                  TOWNS_CLAIM.CHUNK_X.eq(chunk.x()),
                  TOWNS_CLAIM.CHUNK_Z.eq(chunk.z()),
                  TOWNS_CLAIM.TOWN_ID.eq(claim.townId().toString()));
          if (!stored) {
            throw new IllegalStateException("claim " + chunk + " is not stored for that town");
          }
          deleteSettings(dsl, chunk);
          insertSettings(dsl, claim);
        });
  }

  /** Runs {@code work} in a write transaction. */
  private CompletableFuture<Void> write(Consumer<DSLContext> work) {
    return database
        .write(
            dsl -> {
              work.accept(dsl);
              return Boolean.TRUE;
            })
        .thenAccept(done -> {});
  }

  /** Inserts the claim's flags and trusted players. */
  private static void insertSettings(DSLContext dsl, Claim claim) {
    var chunk = claim.chunk();
    for (var flag : claim.flags().enabled()) {
      dsl.insertInto(TOWNS_CLAIM_FLAG)
          .set(TOWNS_CLAIM_FLAG.WORLD, chunk.world())
          .set(TOWNS_CLAIM_FLAG.CHUNK_X, chunk.x())
          .set(TOWNS_CLAIM_FLAG.CHUNK_Z, chunk.z())
          .set(TOWNS_CLAIM_FLAG.FLAG, flag.name())
          .execute();
    }
    for (var player : claim.trusted()) {
      dsl.insertInto(TOWNS_CLAIM_TRUST)
          .set(TOWNS_CLAIM_TRUST.WORLD, chunk.world())
          .set(TOWNS_CLAIM_TRUST.CHUNK_X, chunk.x())
          .set(TOWNS_CLAIM_TRUST.CHUNK_Z, chunk.z())
          .set(TOWNS_CLAIM_TRUST.PLAYER_ID, player.toString())
          .execute();
    }
  }

  private static void deleteSettings(DSLContext dsl, ChunkPos chunk) {
    dsl.deleteFrom(TOWNS_CLAIM_FLAG)
        .where(
            TOWNS_CLAIM_FLAG.WORLD.eq(chunk.world()),
            TOWNS_CLAIM_FLAG.CHUNK_X.eq(chunk.x()),
            TOWNS_CLAIM_FLAG.CHUNK_Z.eq(chunk.z()))
        .execute();
    dsl.deleteFrom(TOWNS_CLAIM_TRUST)
        .where(
            TOWNS_CLAIM_TRUST.WORLD.eq(chunk.world()),
            TOWNS_CLAIM_TRUST.CHUNK_X.eq(chunk.x()),
            TOWNS_CLAIM_TRUST.CHUNK_Z.eq(chunk.z()))
        .execute();
  }
}

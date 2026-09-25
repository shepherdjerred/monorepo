package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_CLAIM;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_CLAIM_FLAG;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_MEMBER;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_TOWN;

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

  @Override
  public CompletableFuture<TownsSnapshot> loadAll() {
    return database.read(dsl -> dsl.transactionResult(config -> load(config.dsl())));
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
                      members.getOrDefault(id, Map.of()));
                });
    var flags = new HashMap<ChunkPos, Set<ClaimFlag>>();
    for (var row : dsl.selectFrom(TOWNS_CLAIM_FLAG).fetch()) {
      flags
          .computeIfAbsent(
              new ChunkPos(row.getWorld(), row.getChunkX(), row.getChunkZ()),
              chunk -> EnumSet.noneOf(ClaimFlag.class))
          .add(ClaimFlag.valueOf(row.getFlag()));
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
                      new ClaimFlags(flags.getOrDefault(chunk, Set.of())));
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
              .execute();
          for (var member : town.members().entrySet()) {
            dsl.insertInto(TOWNS_MEMBER)
                .set(TOWNS_MEMBER.PLAYER_ID, member.getKey().toString())
                .set(TOWNS_MEMBER.TOWN_ID, id)
                .set(TOWNS_MEMBER.ROLE, member.getValue().name())
                .execute();
          }
        });
  }

  @Override
  public CompletableFuture<Void> deleteTown(UUID townId) {
    return write(
        dsl -> {
          var id = townId.toString();
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
          insertFlags(dsl, claim);
        });
  }

  @Override
  public CompletableFuture<Void> removeClaim(ChunkPos chunk) {
    return write(
        dsl -> {
          deleteFlags(dsl, chunk);
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
  public CompletableFuture<Void> saveFlags(Claim claim) {
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
          deleteFlags(dsl, chunk);
          insertFlags(dsl, claim);
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

  private static void insertFlags(DSLContext dsl, Claim claim) {
    var chunk = claim.chunk();
    for (var flag : claim.flags().enabled()) {
      dsl.insertInto(TOWNS_CLAIM_FLAG)
          .set(TOWNS_CLAIM_FLAG.WORLD, chunk.world())
          .set(TOWNS_CLAIM_FLAG.CHUNK_X, chunk.x())
          .set(TOWNS_CLAIM_FLAG.CHUNK_Z, chunk.z())
          .set(TOWNS_CLAIM_FLAG.FLAG, flag.name())
          .execute();
    }
  }

  private static void deleteFlags(DSLContext dsl, ChunkPos chunk) {
    dsl.deleteFrom(TOWNS_CLAIM_FLAG)
        .where(
            TOWNS_CLAIM_FLAG.WORLD.eq(chunk.world()),
            TOWNS_CLAIM_FLAG.CHUNK_X.eq(chunk.x()),
            TOWNS_CLAIM_FLAG.CHUNK_Z.eq(chunk.z()))
        .execute();
  }
}

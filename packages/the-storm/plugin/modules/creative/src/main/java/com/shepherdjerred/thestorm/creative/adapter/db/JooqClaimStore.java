package com.shepherdjerred.thestorm.creative.adapter.db;

import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_CLAIMS;
import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_FLAGS;
import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_TRUST;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.creative.adapter.db.generated.tables.records.CreativeClaimsRecord;
import com.shepherdjerred.thestorm.creative.app.ClaimStore;
import com.shepherdjerred.thestorm.creative.domain.PlotFlag;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotRole;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/** {@link ClaimStore} over claims, roles, and visitor flags. */
public final class JooqClaimStore implements ClaimStore {

  private final StormDatabase database;

  public JooqClaimStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<StoredClaim>> loadAll() {
    return database.read(JooqClaimStore::readAll);
  }

  @Override
  public CompletableFuture<Void> save(StoredClaim claim) {
    return saveAll(List.of(claim));
  }

  @Override
  public CompletableFuture<Void> saveAll(List<StoredClaim> claims) {
    return done(
        database.write(
            dsl -> {
              for (var claim : claims) {
                replace(dsl, claim);
              }
              return true;
            }));
  }

  @Override
  public CompletableFuture<Void> delete(PlotId id) {
    return done(
        database.write(
            dsl ->
                dsl.deleteFrom(CREATIVE_CLAIMS)
                    .where(CREATIVE_CLAIMS.PLOT_X.eq(id.x()))
                    .and(CREATIVE_CLAIMS.PLOT_Z.eq(id.z()))
                    .execute()));
  }

  private static List<StoredClaim> readAll(DSLContext dsl) {
    var access = new HashMap<PlotId, Map<UUID, PlotRole>>();
    for (var row : dsl.selectFrom(CREATIVE_TRUST).fetch()) {
      var id = plotId(row.getPlotX(), row.getPlotZ());
      var members = access.computeIfAbsent(id, ignored -> new LinkedHashMap<>());
      members.put(
          UUID.fromString(column(row.getMember(), "member")),
          PlotRole.parse(column(row.getRole(), "role")));
    }
    var flags = new HashMap<PlotId, Set<PlotFlag>>();
    for (var row : dsl.selectFrom(CREATIVE_FLAGS).fetch()) {
      var id = plotId(row.getPlotX(), row.getPlotZ());
      var enabled = flags.computeIfAbsent(id, ignored -> new LinkedHashSet<>());
      enabled.add(PlotFlag.require(column(row.getFlag(), "flag")));
    }
    var claims = new ArrayList<StoredClaim>();
    for (var row : dsl.selectFrom(CREATIVE_CLAIMS).fetch()) {
      var id = plotId(row.getPlotX(), row.getPlotZ());
      claims.add(toClaim(row, access.getOrDefault(id, Map.of()), flags.getOrDefault(id, Set.of())));
    }
    return List.copyOf(claims);
  }

  static void replace(DSLContext dsl, StoredClaim claim) {
    var updated =
        dsl.update(CREATIVE_CLAIMS)
            .set(CREATIVE_CLAIMS.OWNER, claim.owner().map(UUID::toString).orElse(null))
            .set(CREATIVE_CLAIMS.RELEASED, claim.released())
            .set(CREATIVE_CLAIMS.COUNTS_TOWARD_CAP, claim.countsTowardCap())
            .set(CREATIVE_CLAIMS.NAME, claim.name())
            .set(CREATIVE_CLAIMS.DESCRIPTION, claim.description())
            .set(CREATIVE_CLAIMS.FLOOR, claim.surface().floor().orElse(null))
            .set(CREATIVE_CLAIMS.WALL, claim.surface().wall().orElse(null))
            .set(CREATIVE_CLAIMS.BIOME, claim.surface().biome().orElse(null))
            .set(CREATIVE_CLAIMS.CLUSTER_X, claim.cluster().map(PlotId::x).orElse(null))
            .set(CREATIVE_CLAIMS.CLUSTER_Z, claim.cluster().map(PlotId::z).orElse(null))
            .where(CREATIVE_CLAIMS.PLOT_X.eq(claim.id().x()))
            .and(CREATIVE_CLAIMS.PLOT_Z.eq(claim.id().z()))
            .execute();
    if (updated == 0) {
      dsl.insertInto(CREATIVE_CLAIMS)
          .set(CREATIVE_CLAIMS.PLOT_X, claim.id().x())
          .set(CREATIVE_CLAIMS.PLOT_Z, claim.id().z())
          .set(CREATIVE_CLAIMS.OWNER, claim.owner().map(UUID::toString).orElse(null))
          .set(CREATIVE_CLAIMS.RELEASED, claim.released())
          .set(CREATIVE_CLAIMS.COUNTS_TOWARD_CAP, claim.countsTowardCap())
          .set(CREATIVE_CLAIMS.NAME, claim.name())
          .set(CREATIVE_CLAIMS.DESCRIPTION, claim.description())
          .set(CREATIVE_CLAIMS.FLOOR, claim.surface().floor().orElse(null))
          .set(CREATIVE_CLAIMS.WALL, claim.surface().wall().orElse(null))
          .set(CREATIVE_CLAIMS.BIOME, claim.surface().biome().orElse(null))
          .set(CREATIVE_CLAIMS.CLUSTER_X, claim.cluster().map(PlotId::x).orElse(null))
          .set(CREATIVE_CLAIMS.CLUSTER_Z, claim.cluster().map(PlotId::z).orElse(null))
          .execute();
    }
    dsl.deleteFrom(CREATIVE_TRUST)
        .where(CREATIVE_TRUST.PLOT_X.eq(claim.id().x()))
        .and(CREATIVE_TRUST.PLOT_Z.eq(claim.id().z()))
        .execute();
    dsl.deleteFrom(CREATIVE_FLAGS)
        .where(CREATIVE_FLAGS.PLOT_X.eq(claim.id().x()))
        .and(CREATIVE_FLAGS.PLOT_Z.eq(claim.id().z()))
        .execute();
    for (var member : claim.access().entrySet()) {
      dsl.insertInto(CREATIVE_TRUST)
          .set(CREATIVE_TRUST.PLOT_X, claim.id().x())
          .set(CREATIVE_TRUST.PLOT_Z, claim.id().z())
          .set(CREATIVE_TRUST.MEMBER, member.getKey().toString())
          .set(CREATIVE_TRUST.ROLE, member.getValue().stored())
          .execute();
    }
    for (var flag : claim.flags()) {
      dsl.insertInto(CREATIVE_FLAGS)
          .set(CREATIVE_FLAGS.PLOT_X, claim.id().x())
          .set(CREATIVE_FLAGS.PLOT_Z, claim.id().z())
          .set(CREATIVE_FLAGS.FLAG, flag.stored())
          .execute();
    }
  }

  private static StoredClaim toClaim(
      CreativeClaimsRecord row, Map<UUID, PlotRole> access, Set<PlotFlag> flags) {
    var ownerText = row.getOwner();
    var owner =
        ownerText == null ? Optional.<UUID>empty() : Optional.of(UUID.fromString(ownerText));
    return new StoredClaim(
        plotId(row.getPlotX(), row.getPlotZ()),
        owner,
        column(row.getReleased(), "released"),
        column(row.getCountsTowardCap(), "counts_toward_cap"),
        column(row.getName(), "name"),
        column(row.getDescription(), "description"),
        access,
        flags,
        surface(row),
        cluster(row));
  }

  private static Optional<PlotId> cluster(CreativeClaimsRecord row) {
    var x = row.getClusterX();
    var z = row.getClusterZ();
    if (x == null && z == null) {
      return Optional.empty();
    }
    if (x == null || z == null) {
      throw new IllegalStateException("creative claim cluster is incomplete");
    }
    return Optional.of(new PlotId(x, z));
  }

  private static PlotSurface surface(CreativeClaimsRecord row) {
    var floor = row.getFloor();
    var wall = row.getWall();
    var biome = row.getBiome();
    return new PlotSurface(
        floor == null ? Optional.empty() : Optional.of(PlotSurface.requireFloor(floor)),
        wall == null ? Optional.empty() : Optional.of(PlotSurface.requireWall(wall)),
        biome == null ? Optional.empty() : Optional.of(PlotSurface.requireBiome(biome)));
  }

  private static PlotId plotId(Integer x, Integer z) {
    return new PlotId(column(x, "plot_x"), column(z, "plot_z"));
  }

  private static <T> T column(T value, String name) {
    if (value == null) {
      throw new IllegalStateException("creative claim column " + name + " is null");
    }
    return value;
  }

  private static CompletableFuture<Void> done(CompletableFuture<?> write) {
    return write.thenAccept(result -> {});
  }
}

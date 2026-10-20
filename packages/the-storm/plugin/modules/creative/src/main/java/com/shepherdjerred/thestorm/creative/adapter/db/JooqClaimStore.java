package com.shepherdjerred.thestorm.creative.adapter.db;

import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_CLAIMS;
import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_TRUST;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.creative.adapter.db.generated.tables.records.CreativeClaimsRecord;
import com.shepherdjerred.thestorm.creative.app.ClaimStore;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/** {@link ClaimStore} over {@code creative_claims} and {@code creative_trust}. */
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
    return done(
        database.write(
            dsl -> {
              replace(dsl, claim);
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
    var trusted = new HashMap<PlotId, Set<UUID>>();
    for (var row : dsl.selectFrom(CREATIVE_TRUST).fetch()) {
      var id = plotId(row.getPlotX(), row.getPlotZ());
      var members = trusted.computeIfAbsent(id, ignored -> new LinkedHashSet<>());
      members.add(UUID.fromString(column(row.getMember(), "member")));
    }
    var claims = new ArrayList<StoredClaim>();
    for (var row : dsl.selectFrom(CREATIVE_CLAIMS).fetch()) {
      var id = plotId(row.getPlotX(), row.getPlotZ());
      claims.add(toClaim(row, trusted.getOrDefault(id, Set.of())));
    }
    return List.copyOf(claims);
  }

  private static void replace(DSLContext dsl, StoredClaim claim) {
    dsl.deleteFrom(CREATIVE_CLAIMS)
        .where(CREATIVE_CLAIMS.PLOT_X.eq(claim.id().x()))
        .and(CREATIVE_CLAIMS.PLOT_Z.eq(claim.id().z()))
        .execute();
    dsl.insertInto(CREATIVE_CLAIMS)
        .set(CREATIVE_CLAIMS.PLOT_X, claim.id().x())
        .set(CREATIVE_CLAIMS.PLOT_Z, claim.id().z())
        .set(CREATIVE_CLAIMS.OWNER, claim.owner().map(UUID::toString).orElse(null))
        .set(CREATIVE_CLAIMS.RELEASED, claim.released())
        .set(CREATIVE_CLAIMS.COUNTS_TOWARD_CAP, claim.countsTowardCap())
        .set(CREATIVE_CLAIMS.NAME, claim.name())
        .set(CREATIVE_CLAIMS.DESCRIPTION, claim.description())
        .execute();
    for (var member : claim.trusted()) {
      dsl.insertInto(CREATIVE_TRUST)
          .set(CREATIVE_TRUST.PLOT_X, claim.id().x())
          .set(CREATIVE_TRUST.PLOT_Z, claim.id().z())
          .set(CREATIVE_TRUST.MEMBER, member.toString())
          .execute();
    }
  }

  private static StoredClaim toClaim(CreativeClaimsRecord row, Set<UUID> trusted) {
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
        trusted);
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

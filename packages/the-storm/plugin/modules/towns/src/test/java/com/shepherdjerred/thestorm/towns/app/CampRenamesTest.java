package com.shepherdjerred.thestorm.towns.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownNames;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

/** Generated camp names become the founder's account name when the directory knows them. */
final class CampRenamesTest {

  @Test
  void aKnownOwnerRenamesTheCamp() {
    var owner = UUID.randomUUID();
    var state = new TownsState(new RegionIndex(List.of()));
    var camp = generated(owner);
    state.addTown(camp);
    var saved = new ArrayList<Town>();

    var renamed =
        CampRenames.apply(state, store(saved), directory(owner, "Lincbuggy"), ignored -> {}).join();

    assertThat(renamed).isEqualTo(1);
    assertThat(saved).singleElement().extracting(Town::name).isEqualTo("Lincbuggy");
    assertThat(state.town(camp.id()).orElseThrow().name()).isEqualTo("Lincbuggy");
  }

  @Test
  void aMissingOwnerLeavesTheGeneratedName() {
    var owner = UUID.randomUUID();
    var state = new TownsState(new RegionIndex(List.of()));
    var camp = generated(owner);
    state.addTown(camp);
    var notes = new StringBuilder();

    var renamed =
        CampRenames.apply(
                state,
                store(new ArrayList<>()),
                directory(UUID.randomUUID(), "Other"),
                notes::append)
            .join();

    assertThat(renamed).isZero();
    assertThat(state.town(camp.id()).orElseThrow().name()).isEqualTo(camp.name());
    assertThat(notes).contains(camp.name());
  }

  private static Town generated(UUID owner) {
    var id = UUID.randomUUID();
    return Town.camp(id, TownNames.campName(id), Instant.EPOCH, owner);
  }

  private static PlayerDirectory directory(UUID id, String name) {
    var known = new KnownPlayer(id, name, Instant.EPOCH);
    return new PlayerDirectory() {
      @Override
      public CompletableFuture<Optional<KnownPlayer>> byName(String ignored) {
        return CompletableFuture.completedFuture(Optional.empty());
      }

      @Override
      public CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid) {
        return CompletableFuture.completedFuture(
            uuid.equals(id) ? Optional.of(known) : Optional.empty());
      }
    };
  }

  private static TownsStore store(List<Town> saved) {
    return new TownsStore() {
      @Override
      public CompletableFuture<TownsSnapshot> loadAll() {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> createTown(Town town) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> saveTown(Town town) {
        saved.add(town);
        return CompletableFuture.completedFuture(null);
      }

      @Override
      public CompletableFuture<Set<UUID>> saveDeparture(Town town, UUID departed) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> deleteTown(TownPayout payout) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> deleteCamp(UUID townId, Map<UUID, String> notices) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Optional<String>> notice(UUID player) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> clearNotice(UUID player) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<List<TownPayout>> pendingPayouts() {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> clearPayout(TownPayout payout) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> addClaim(Claim claim, Instant at) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> addClaimAndSaveTown(Claim claim, Instant at, Town town) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> removeClaim(ChunkPos chunk) {
        throw new UnsupportedOperationException();
      }

      @Override
      public CompletableFuture<Void> saveClaim(Claim claim) {
        throw new UnsupportedOperationException();
      }
    };
  }
}

package com.shepherdjerred.thestorm.towns.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class TownListingsTest {

  @Test
  void listsLoadedTownsAlphabeticallyWithTotalCount() {
    var state = new TownsState(new RegionIndex(List.of()));
    state.addTown(Town.found(UUID.randomUUID(), "Zephyr", Instant.EPOCH, UUID.randomUUID()));
    state.addTown(Town.found(UUID.randomUUID(), "Aegis", Instant.EPOCH, UUID.randomUUID()));

    var listing = new TownListings(state).list(1);
    assertThat(listing.total()).isEqualTo(2);
    assertThat(listing.towns()).containsExactly(new TownRead.TownSummary("Aegis", 1, 0));
  }

  @Test
  void rejectsUnboundedPageSizes() {
    var listings = new TownListings(new TownsState(new RegionIndex(List.of())));
    assertThatThrownBy(() -> listings.list(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> listings.list(26)).isInstanceOf(IllegalArgumentException.class);
  }
}

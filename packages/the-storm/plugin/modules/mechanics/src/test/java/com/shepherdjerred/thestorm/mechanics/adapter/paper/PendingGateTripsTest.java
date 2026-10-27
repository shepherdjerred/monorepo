package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

final class PendingGateTripsTest {
  @Test
  void oldCompletionCannotRemoveNewTripEvenToSameDestination() {
    var trips = new PendingGateTrips<String>();
    var player = UUID.randomUUID();
    var old = trips.start(player, "same destination");
    var current = trips.start(player, "same destination");

    trips.finish(player, old);
    assertThat(trips.get(player)).isEqualTo("same destination");
    trips.finish(player, current);
    assertThat(trips.get(player)).isNull();
  }
}

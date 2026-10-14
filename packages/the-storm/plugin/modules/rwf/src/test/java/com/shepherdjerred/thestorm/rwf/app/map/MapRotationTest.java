package com.shepherdjerred.thestorm.rwf.app.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

class MapRotationTest {
  private static final class Entry implements MapRotation.Entry {
    private final String id;
    private Consumer<Boolean> completion = _ -> {};
    private boolean ready;
    private int prepares;
    private int releases;
    private int activations;

    Entry(String id) {
      this.id = id;
    }

    @Override
    public String id() {
      return id;
    }

    @Override
    public void prepare(Consumer<Boolean> done) {
      prepares++;
      completion =
          ok -> {
            ready = ok;
            done.accept(ok);
          };
    }

    @Override
    public boolean ready() {
      return ready;
    }

    @Override
    public void activate(Consumer<Boolean> done) {
      activations++;
      done.accept(ready);
    }

    @Override
    public void release() {
      releases++;
      ready = false;
    }
  }

  @Test
  void aBallotOffersDistinctMapsAndLeavesOutTheMapJustPlayedOnceThereAreFour() {
    var maps = List.of(new Entry("a"), new Entry("b"), new Entry("c"), new Entry("d"));
    try (var rotation = new MapRotation<>(maps, new Random(1))) {
      rotation.play(maps.getFirst());
      for (var i = 0; i < 50; i++) {
        var offered = rotation.candidates(3).stream().map(Entry::id).toList();
        assertThat(offered).hasSize(3).doesNotHaveDuplicates().doesNotContain("a");
      }
    }
  }

  @Test
  void withFewerThanFourMapsTheMapJustPlayedMayComeAgain() {
    var maps = List.of(new Entry("a"), new Entry("b"));
    try (var rotation = new MapRotation<>(maps, new Random(2))) {
      rotation.play(maps.getFirst());
      var seen = new HashSet<String>();
      for (var i = 0; i < 20; i++) {
        rotation.candidates(3).forEach(map -> seen.add(map.id()));
      }
      assertThat(seen).containsExactlyInAnyOrder("a", "b");
    }
  }

  @Test
  void askingAgainForTheMapAlreadyLoadingWaitsOnThatLoadAndAnswersOnlyTheLatest() {
    var one = new Entry("one");
    try (var rotation = new MapRotation<>(List.of(one, new Entry("two")), new Random(4))) {
      var first = new ArrayList<Boolean>();
      var second = new ArrayList<Boolean>();
      rotation.prepare(one, first::add);
      rotation.prepare(one, second::add);

      assertThat(one.prepares).isEqualTo(1);
      one.completion.accept(true);
      assertThat(first).isEmpty();
      assertThat(second).containsExactly(true);

      var third = new ArrayList<Boolean>();
      rotation.prepare(one, third::add);
      assertThat(third).containsExactly(true);
      assertThat(one.prepares).isEqualTo(1);
    }
  }

  @Test
  void aMapThatFailedToLoadIsReleasedAndPreparedAfreshWhenChosenAgain() {
    var one = new Entry("one");
    try (var rotation = new MapRotation<>(List.of(one, new Entry("two")), new Random(5))) {
      var first = new ArrayList<Boolean>();
      rotation.prepare(one, first::add);
      one.completion.accept(false);
      assertThat(first).containsExactly(false);
      assertThat(one.releases).isEqualTo(1);

      var second = new ArrayList<Boolean>();
      rotation.prepare(one, second::add);
      assertThat(one.prepares).isEqualTo(2);
      one.completion.accept(true);
      assertThat(second).containsExactly(true);
    }
  }

  @Test
  void preparingTheChosenMapReportsOnceAndPlayingItReleasesThePreviousOne() {
    var one = new Entry("one");
    var two = new Entry("two");
    try (var rotation = new MapRotation<>(List.of(one, two), new Random(3))) {
      rotation.play(one);
      var results = new ArrayList<Boolean>();
      rotation.prepare(two, results::add);
      assertThat(two.prepares).isEqualTo(1);
      assertThat(results).isEmpty();
      two.completion.accept(true);
      assertThat(results).containsExactly(true);
      assertThat(one.releases).isZero();
      rotation.play(two);
      assertThat(one.releases).isEqualTo(1);
      assertThat(rotation.active()).contains(two);
    }
  }

  @Test
  void theActiveMapStillReadyNeedsNoNewPreparation() {
    var only = new Entry("only");
    try (var rotation = new MapRotation<>(List.of(only), new Random(4))) {
      only.prepare(_ -> {});
      only.completion.accept(true);
      rotation.play(only);
      var results = new ArrayList<Boolean>();
      rotation.prepare(only, results::add);
      assertThat(results).containsExactly(true);
      assertThat(only.prepares).isEqualTo(1);
    }
  }

  @Test
  void aSupersededPreparationIsDroppedAndItsMapReleased() {
    var one = new Entry("one");
    var two = new Entry("two");
    var three = new Entry("three");
    try (var rotation = new MapRotation<>(List.of(one, two, three), new Random(5))) {
      var results = new ArrayList<String>();
      rotation.prepare(two, ok -> results.add("two " + ok));
      rotation.prepare(three, ok -> results.add("three " + ok));
      assertThat(two.releases).isEqualTo(1);
      two.completion.accept(true);
      three.completion.accept(true);
      assertThat(results).containsExactly("three true");
    }
  }

  @Test
  void closingDropsLatePreparationAndRefusesNewOnes() {
    var one = new Entry("one");
    var two = new Entry("two");
    var rotation = new MapRotation<>(List.of(one, two), new Random(6));
    var results = new ArrayList<Boolean>();
    rotation.prepare(two, results::add);
    rotation.close();
    two.completion.accept(true);
    assertThat(results).isEmpty();
    assertThatThrownBy(() -> rotation.prepare(one, results::add))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aQuarantinedMapLeavesEveryBallotButTheLastMapStays() {
    var one = new Entry("one");
    var two = new Entry("two");
    try (var rotation = new MapRotation<>(List.of(one, two), new Random(7))) {
      assertThat(rotation.quarantine("two")).isTrue();
      assertThat(rotation.candidates(3)).containsExactly(one);
      assertThat(rotation.quarantine("missing")).isFalse();
      assertThatThrownBy(() -> rotation.quarantine("one"))
          .isInstanceOf(IllegalStateException.class);
    }
  }

  @Test
  void candidateTerrainLoadsSeriallyAndOnlyTheSelectedWinnerActivates() {
    var old = new Entry("old");
    var one = new Entry("one");
    var two = new Entry("two");
    var three = new Entry("three");
    try (var rotation = new MapRotation<>(List.of(old, one, two, three), new Random(8))) {
      rotation.play(old);
      var results = new ArrayList<Boolean>();
      rotation.prepareCandidates(List.of(one, two, three), results::add);
      assertThat(old.releases).isEqualTo(1);
      assertThat(one.prepares).isEqualTo(1);
      assertThat(two.prepares).isZero();
      one.completion.accept(true);
      assertThat(rotation.visitable("one")).isTrue();
      assertThat(rotation.visitable("two")).isFalse();
      assertThat(two.prepares).isEqualTo(1);
      two.completion.accept(true);
      assertThat(three.prepares).isEqualTo(1);
      three.completion.accept(true);
      assertThat(results).containsExactly(true);
      assertThat(one.activations + two.activations + three.activations).isZero();
      var selected = new ArrayList<Boolean>();
      rotation.prepare(two, selected::add);
      assertThat(selected).containsExactly(true);
      assertThat(two.prepares).isEqualTo(1);
      assertThat(two.activations).isEqualTo(1);
      assertThat(one.releases).isEqualTo(1);
      assertThat(three.releases).isEqualTo(1);
      rotation.play(two);
      assertThat(old.releases).isEqualTo(1);
      assertThat(rotation.active()).contains(two);
    }
  }

  @Test
  void replacingOrCancellingCandidatePreparationDropsLateCompletions() {
    var one = new Entry("one");
    var two = new Entry("two");
    var three = new Entry("three");
    try (var rotation = new MapRotation<>(List.of(one, two, three), new Random(9))) {
      var results = new ArrayList<Boolean>();
      rotation.prepareCandidates(List.of(one, two), results::add);
      var oldCompletion = one.completion;
      rotation.prepareCandidates(List.of(three), results::add);
      oldCompletion.accept(true);
      assertThat(two.prepares).isZero();
      assertThat(one.releases).isEqualTo(1);
      assertThat(results).isEmpty();
      rotation.cancelVisits();
      three.completion.accept(true);
      assertThat(results).isEmpty();
      assertThat(three.releases).isEqualTo(1);
      assertThat(rotation.visitable("three")).isFalse();
    }
  }

  @Test
  void aFailedCandidateStopsSerialLoadingAndReportsFailureWithoutChoosingAnotherMap() {
    var one = new Entry("one");
    var two = new Entry("two");
    try (var rotation = new MapRotation<>(List.of(one, two), new Random(10))) {
      var results = new ArrayList<Boolean>();
      rotation.prepareCandidates(List.of(one, two), results::add);
      one.completion.accept(false);
      assertThat(results).containsExactly(false);
      assertThat(two.prepares).isZero();
      assertThat(one.releases).isEqualTo(1);
      assertThat(rotation.active()).isEmpty();
      rotation.cancelVisits();
      assertThat(one.releases).isEqualTo(1);
    }
  }
}

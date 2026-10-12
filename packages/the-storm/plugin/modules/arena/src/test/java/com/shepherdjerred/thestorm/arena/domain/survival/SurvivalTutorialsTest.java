package com.shepherdjerred.thestorm.arena.domain.survival;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class SurvivalTutorialsTest {
  @Test
  void simultaneousContextsTeachOnePrerequisiteInStableOrder() {
    var graph = SurvivalTutorials.catalog();
    var contexts =
        Set.of(
            TutorialKey.of(TutorialKey.Topic.AUGMENTATION),
            new TutorialKey(TutorialKey.Topic.DROP, "WILDGROWTH"));
    var seen = new HashSet<TutorialKey>();
    assertThat(graph.next(contexts, seen).orElseThrow().key())
        .isEqualTo(TutorialKey.of(TutorialKey.Topic.ENTRY));
    while (graph.next(contexts, seen).isPresent()) {
      var tip = graph.next(contexts, seen).orElseThrow();
      assertThat(seen).containsAll(tip.parents());
      seen.add(tip.key());
    }
    assertThat(seen)
        .contains(
            TutorialKey.of(TutorialKey.Topic.PLANE),
            TutorialKey.of(TutorialKey.Topic.ENCHANTING),
            TutorialKey.of(TutorialKey.Topic.AUGMENTATION),
            new TutorialKey(TutorialKey.Topic.DROP, "WILDGROWTH"));
    assertThat(seen).doesNotContain(TutorialKey.of(TutorialKey.Topic.CLASSES));
  }

  @Test
  void identifiersRoundTripAndMalformedDataFails() {
    for (var tip : SurvivalTutorials.catalog().tips())
      assertThat(TutorialKey.decode(tip.key().encode())).isEqualTo(tip.key());
    assertThatThrownBy(() -> TutorialKey.decode("DROP:NUKE"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TutorialKey.decode("POWER:extra"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TutorialKey.decode("unknown"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void cyclesAndMissingParentsAreRejected() {
    var entry = TutorialKey.of(TutorialKey.Topic.ENTRY);
    var combat = TutorialKey.of(TutorialKey.Topic.COMBAT);
    var a = new TutorialGraph.Tip(entry, "Entry", Set.of(combat));
    var b = new TutorialGraph.Tip(combat, "Combat", Set.of(entry));
    assertThatThrownBy(() -> new TutorialGraph(List.of(a, b)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("cycle");
    assertThatThrownBy(() -> new TutorialGraph(List.of(a)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Missing");
    assertThatThrownBy(() -> new TutorialGraph(List.of(b, b)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Duplicate");
  }
}

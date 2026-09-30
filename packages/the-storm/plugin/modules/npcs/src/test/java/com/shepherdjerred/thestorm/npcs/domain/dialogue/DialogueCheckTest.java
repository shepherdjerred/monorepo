package com.shepherdjerred.thestorm.npcs.domain.dialogue;

import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.choices;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.close;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.goTo;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.graph;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.option;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.then;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.DialogueNode;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class DialogueCheckTest {

  @Test
  void aBranchingConversationIsValid() {
    var graph =
        graph(
            "greet",
            Map.of(
                "greet",
                    choices(
                        "Hello",
                        goTo("about"),
                        option("Train", new OptionEffect.OpenTrainer()),
                        close()),
                "about", then("About me", "more"),
                "more", then("And more", "greet")));
    assertThat(DialogueCheck.problems(graph)).isEmpty();
    assertThat(graph.problems()).isEmpty();
  }

  @Test
  void loopsThroughAChoiceAreAllowed() {
    var graph =
        graph(
            "ask",
            Map.of(
                "ask", choices("Ask?", goTo("answer"), close()),
                "answer", choices("Answer", goTo("ask"))));
    assertThat(DialogueCheck.problems(graph)).isEmpty();
  }

  @Test
  void loopsOfOnlyNextLinksAreRejectedOnce() {
    var graph =
        graph(
            "start",
            Map.of(
                "start", choices("Start", goTo("b"), close()),
                "b", then("B", "c"),
                "c", then("C", "d"),
                "d", then("D", "b")));
    assertThat(DialogueCheck.problems(graph))
        .containsExactly(
            "nodes b -> c -> d -> b loop through next links only; give one an option with goto instead");
  }

  @Test
  void aNodeContinuingToItselfIsALoop() {
    var graph = graph("a", Map.of("a", then("A", "a")));
    assertThat(DialogueCheck.problems(graph))
        .singleElement()
        .asString()
        .contains("nodes a -> a loop");
  }

  @Test
  void reportsMissingTargetsAndStart() {
    var graph =
        graph(
            "missing",
            Map.of(
                "a", choices("A", goTo("nowhere")),
                "b", then("B", "gone")));
    assertThat(DialogueCheck.problems(graph))
        .containsExactly(
            "start node missing does not exist",
            "node a: goto target nowhere does not exist",
            "node b: next node gone does not exist");
  }

  @Test
  void reportsUnreachableNodes() {
    var graph =
        graph(
            "a",
            Map.of(
                "a", choices("A", close()),
                "island", choices("I", goTo("peninsula")),
                "peninsula", then("P", "a")));
    assertThat(DialogueCheck.problems(graph))
        .containsExactly(
            "node island is unreachable from a", "node peninsula is unreachable from a");
  }

  @Test
  void aNodeNeedsExactlyOneOfNextOrOptions() {
    var both = new DialogueNode("Both", Optional.of("a"), List.of(close()));
    var neither = new DialogueNode("Neither", Optional.empty(), List.of());
    var graph =
        graph(
            "a",
            Map.of(
                "a",
                choices("A", goTo("both"), goTo("neither")),
                "both",
                both,
                "neither",
                neither));
    assertThat(DialogueCheck.problems(graph))
        .containsExactly(
            "node both: needs either next (a Continue button) or options, not both or neither",
            "node neither: needs either next (a Continue button) or options, not both or neither");
  }

  @Test
  void enforcesBedrockFriendlyLimits() {
    var longText = "x".repeat(DialogueCheck.MAX_TEXT + 1);
    var longLabel = "y".repeat(DialogueCheck.MAX_LABEL + 1);
    var tooMany = choices("Many", close(), close(), close(), close(), close(), close(), close());
    var graph =
        new DialogueGraph(
            "limits",
            "t".repeat(DialogueCheck.MAX_TITLE + 1),
            "a",
            Map.of(
                "a", choices(longText, option(longLabel, new OptionEffect.Close()), goTo("b")),
                "b", tooMany,
                "c", choices("  ", close())));
    assertThat(DialogueCheck.problems(graph))
        .contains(
            "title is longer than 48 characters",
            "node a: text must be 1..600 characters",
            "node a: option label \"" + longLabel + "\" must be 1..32 characters",
            "node b: has more than 6 options",
            "node c: text must be 1..600 characters");
  }

  @ParameterizedTest
  @ValueSource(strings = {"accept", "Quests.accept", "quests.", ".accept", "quests accept"})
  void actionsMustBeNamespaced(String action) {
    var graph =
        graph("a", Map.of("a", choices("A", option("Go", new OptionEffect.RunAction(action)))));
    assertThat(DialogueCheck.problems(graph))
        .containsExactly("node a: action " + action + " must be namespaced, such as quests.accept");
  }

  @Test
  void namespacedActionsPass() {
    var graph =
        graph(
            "a",
            Map.of(
                "a",
                choices("A", option("Go", new OptionEffect.RunAction("quests.accept_intro")))));
    assertThat(DialogueCheck.problems(graph)).isEmpty();
  }

  @Test
  void nodeIdsAreLowercaseWords() {
    var graph = graph("Start", Map.of("Start", choices("A", close())));
    assertThat(DialogueCheck.problems(graph))
        .containsExactly("node Start: id must be lowercase letters, digits, - and _");
  }
}

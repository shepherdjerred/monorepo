package com.shepherdjerred.thestorm.npcs.domain.dialogue;

import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.choices;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.close;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.goTo;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.graph;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.option;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.then;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Conversations.Clicked;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Button;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Choice;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ConversationsTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");

  private static final Screen SCREEN =
      new Screen(
          "Stan",
          "Hello",
          List.of(
              new Button("Train", new Choice.OpenTrainer()),
              new Button("Bye", new Choice.Close())));

  @Test
  void aClickCountsOnce() {
    var conversations = new Conversations();
    var token = conversations.show(ALICE, "stan", SCREEN);
    assertThat(conversations.click(ALICE, token, 0))
        .contains(new Clicked("stan", new Choice.OpenTrainer()));
    // The Dialog API can deliver the same click again.
    assertThat(conversations.click(ALICE, token, 0)).isEmpty();
    assertThat(conversations.click(ALICE, token, 1)).isEmpty();
    assertThat(conversations.current(ALICE)).isEmpty();
  }

  @Test
  void aReplacedScreenIgnoresClicksOnTheOldOne() {
    var conversations = new Conversations();
    var first = conversations.show(ALICE, "stan", SCREEN);
    var second = conversations.show(ALICE, "nat", SCREEN);
    assertThat(second).isGreaterThan(first);
    assertThat(conversations.click(ALICE, first, 1)).isEmpty();
    assertThat(conversations.click(ALICE, second, 1))
        .contains(new Clicked("nat", new Choice.Close()));
  }

  @Test
  void ignoresOutOfRangeButtonsAndOtherPlayers() {
    var conversations = new Conversations();
    var token = conversations.show(ALICE, "stan", SCREEN);
    assertThat(conversations.click(ALICE, token, 2)).isEmpty();
    assertThat(conversations.click(ALICE, token, -1)).isEmpty();
    assertThat(conversations.click(BOB, token, 0)).isEmpty();
    // None of those consumed the screen.
    assertThat(conversations.click(ALICE, token, 1)).isPresent();
  }

  @Test
  void forgettingAPlayerDropsTheirScreen() {
    var conversations = new Conversations();
    var token = conversations.show(ALICE, "stan", SCREEN);
    conversations.forget(ALICE);
    assertThat(conversations.click(ALICE, token, 0)).isEmpty();
  }

  @Test
  void aNodeBecomesAScreen() {
    var graph =
        graph(
            "greet",
            Map.of(
                "greet",
                choices(
                    "Hello",
                    goTo("about"),
                    option("Train", new OptionEffect.OpenTrainer()),
                    option("Quest", new OptionEffect.RunAction("quests.accept")),
                    close()),
                "about",
                then("About", "greet")));
    var greet = DialogueScreens.node(graph, "greet", "Continue");
    assertThat(greet.title()).isEqualTo("Title");
    assertThat(greet.body()).isEqualTo("Hello");
    assertThat(greet.buttons())
        .containsExactly(
            new Button("To about", new Choice.ShowNode(graph, "about")),
            new Button("Train", new Choice.OpenTrainer()),
            new Button("Quest", new Choice.RunAction("quests.accept")),
            new Button("Bye", new Choice.Close()));
    assertThat(DialogueScreens.node(graph, "about", "Onward").buttons())
        .containsExactly(new Button("Onward", new Choice.ShowNode(graph, "greet")));
    assertThatThrownBy(() -> DialogueScreens.node(graph, "missing", "Continue"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aScreenNeedsAButton() {
    assertThatThrownBy(() -> new Screen("t", "b", List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}

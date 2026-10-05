package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwf.app.view.Transition;
import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatMoment;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** rwf's transitions read as chat moments, with names as players read them. */
final class ChatMomentsTest {

  private static final UUID MATCH = new UUID(9, 9);
  private static final UUID HUMAN = new UUID(0, 1);
  private static final UUID BOT = new UUID(0, 2);

  private static MatchState state(
      MatchState.Phase phase, List<MatchState.Bomb> bombs, Optional<String> winner) {
    return new MatchState(
        MATCH,
        phase,
        Optional.of("synthetic"),
        List.of("red", "blue"),
        List.of(
            new MatchState.Fighter(
                HUMAN,
                "Alice",
                Optional.empty(),
                Optional.of("blue"),
                Optional.of("trooper"),
                true),
            new MatchState.Fighter(
                BOT,
                "Red_Bot",
                Optional.of("red-bot"),
                Optional.of("red"),
                Optional.of("trooper"),
                true)),
        bombs,
        Optional.empty(),
        winner,
        Optional.empty());
  }

  private static MatchState.Bomb bomb(String id, boolean nuke, String team, MatchState.Status s) {
    return new MatchState.Bomb(id, nuke, Optional.of(team), 0, 0, 0, s);
  }

  private static final MatchState.Status IDLE = new MatchState.Status.Idle();
  private static final MatchState.Status ARMED = new MatchState.Status.Armed(40, Optional.empty());

  private static MatchState live(List<MatchState.Bomb> bombs) {
    return state(MatchState.Phase.LIVE, bombs, Optional.empty());
  }

  @Test
  void goingLiveStartsTheMatchAndNothingElseCountsBeforeIt() {
    var lobby = state(MatchState.Phase.COUNTDOWN, List.of(), Optional.empty());
    var start = new Transition(new Transition.Change.Ticked(), List.of(), live(List.of()));
    assertThat(ChatMoments.of(lobby, start)).containsExactly(new ChatMoment.Started());

    var died =
        new Transition(new Transition.Change.Died(BOT, Optional.of(HUMAN)), List.of(), lobby);
    assertThat(ChatMoments.of(lobby, died)).as("no chat outside a live match").isEmpty();
  }

  @Test
  void deathsByCombatantsAndByTheRulesBothCount() {
    var before = live(List.of());
    var transition =
        new Transition(
            new Transition.Change.Died(BOT, Optional.of(HUMAN)),
            List.of(
                new Transition.Effect.Spectating(BOT),
                new Transition.Effect.Killed(List.of(HUMAN))),
            before);

    assertThat(ChatMoments.of(before, transition))
        .containsExactly(
            new ChatMoment.Died(BOT, Optional.of(HUMAN)),
            new ChatMoment.Died(HUMAN, Optional.empty()));
  }

  @Test
  void armedAndDefusedStatsNameTheBombThatChanged() {
    var idle =
        live(List.of(bomb("red-1", false, "red", IDLE), bomb("blue-1", false, "blue", IDLE)));
    var blueArmed =
        live(List.of(bomb("red-1", false, "red", IDLE), bomb("blue-1", false, "blue", ARMED)));
    var armed =
        new Transition(
            new Transition.Change.Ticked(),
            List.of(new Transition.Effect.StatRecorded(BOT, "Armed")),
            blueArmed);
    assertThat(ChatMoments.of(idle, armed))
        .containsExactly(new ChatMoment.Planted(BOT, "Blue Team's bomb", false));

    var defused =
        new Transition(
            new Transition.Change.Ticked(),
            List.of(new Transition.Effect.StatRecorded(HUMAN, "Defused")),
            idle);
    assertThat(ChatMoments.of(blueArmed, defused))
        .containsExactly(new ChatMoment.Defused(HUMAN, "Blue Team's bomb"));

    var nukeIdle =
        live(List.of(new MatchState.Bomb("nuke", true, Optional.empty(), 0, 0, 0, IDLE)));
    var nukeArmed = live(List.of(bomb("nuke", true, "red", ARMED)));
    assertThat(
            ChatMoments.of(
                nukeIdle,
                new Transition(
                    new Transition.Change.Ticked(),
                    List.of(new Transition.Effect.StatRecorded(BOT, "Armed")),
                    nukeArmed)))
        .containsExactly(new ChatMoment.Planted(BOT, "the nuke", true));
  }

  @Test
  void anArmedStatWithNoBombArmedIsABrokenContract() {
    var idle = live(List.of(bomb("blue-1", false, "blue", IDLE)));
    var transition =
        new Transition(
            new Transition.Change.Ticked(),
            List.of(new Transition.Effect.StatRecorded(BOT, "Armed")),
            idle);
    assertThatThrownBy(() -> ChatMoments.of(idle, transition))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("armed");
  }

  @Test
  void theEndCarriesTheWinnersTeamName() {
    var before = live(List.of());
    var won = state(MatchState.Phase.ENDED, List.of(), Optional.of("red"));
    assertThat(
            ChatMoments.of(before, new Transition(new Transition.Change.Ticked(), List.of(), won)))
        .containsExactly(new ChatMoment.Ended(Optional.of("Red Team")));
    var stopped = state(MatchState.Phase.LOBBY, List.of(), Optional.empty());
    assertThat(
            ChatMoments.of(
                before, new Transition(new Transition.Change.Stopped(), List.of(), stopped)))
        .as("a stopped match has no end lines")
        .isEmpty();
  }

  @Test
  void theSceneCarriesEachBotsPersonalityAndTeamNames() {
    var personality = Fixtures.personality("red-bot", "Red_Bot", 0.5);
    var scene =
        ChatMoments.scene(
            live(List.of()),
            uuid -> uuid.equals(BOT) ? Optional.of(personality) : Optional.empty());

    assertThat(scene.member(BOT).orElseThrow().bot()).contains(personality);
    assertThat(scene.member(BOT).orElseThrow().team()).contains("Red Team");
    assertThat(scene.member(HUMAN).orElseThrow().bot()).isEmpty();
    assertThat(scene.member(HUMAN).orElseThrow().name()).isEqualTo("Alice");
    assertThat(ChatMoments.teamName("purple")).isEqualTo("Purple Team");
  }
}

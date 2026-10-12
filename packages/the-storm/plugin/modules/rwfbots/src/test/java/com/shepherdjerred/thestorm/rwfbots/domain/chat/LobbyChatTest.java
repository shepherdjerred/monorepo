package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines.Moment;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The director before the match: bots greet as they walk in, one bot answers a human in kind, the
 * countdown's end gets one remark, idle time brings small talk or a jab at a rival, and none of it
 * names a team, since there are none yet. The usual cooldowns and rate limit apply.
 */
final class LobbyChatTest {

  private static final Instant T0 = Instant.parse("2026-10-04T12:00:00Z");
  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID ONE = new UUID(0, 11);
  private static final UUID TWO = new UUID(0, 12);
  private static final UUID THREE = new UUID(0, 13);

  private static ChatScene.Member waiting(UUID uuid, String name, String id, List<String> rivals) {
    return new ChatScene.Member(
        uuid,
        name,
        Optional.of(ChatDirectorTest.bot(id, Archetype.FLANKER, Set.of(Quirk.SPINS), rivals)),
        Optional.empty(),
        false);
  }

  private static ChatScene lobby(List<String> rivals) {
    return new ChatScene(
        List.of(
            new ChatScene.Member(ALICE, "Alice", Optional.empty(), Optional.empty(), false),
            waiting(ONE, "One", "bot-one", rivals),
            waiting(TWO, "Two", "bot-two", List.of()),
            waiting(THREE, "Three", "bot-three", List.of())));
  }

  private static ChatDirector director() {
    return new ChatDirector(ChatDirectorTest.settings(1), new SplittableRandom(5), T0);
  }

  @Test
  void aBotWalkingInGreetsWithALineThatNamesNoTeam() {
    var lines = director().on(new ChatMoment.Arrived(TWO), lobby(List.of()), T0);

    assertThat(lines)
        .singleElement()
        .satisfies(
            line -> {
              assertThat(line.speaker()).isEqualTo(TWO);
              assertThat(line.moment()).isEqualTo(Moment.GREET);
              assertThat(line.team()).isEmpty();
              assertThat(line.text()).isEqualTo("hello");
            });
  }

  @Test
  void aHumansHelloGetsOneGreetingBackAndOtherChatOneRemark() {
    var director = director();

    var hello = director.on(new ChatMoment.HumanSaid(ALICE, "heyyy all"), lobby(List.of()), T0);
    var chat =
        director.on(
            new ChatMoment.HumanSaid(ALICE, "what kit is best?"),
            lobby(List.of()),
            T0.plusSeconds(30));

    assertThat(hello)
        .singleElement()
        .satisfies(
            line -> {
              assertThat(line.moment()).isEqualTo(Moment.GREET);
              assertThat(line.speaker()).isNotEqualTo(ALICE);
            });
    assertThat(chat)
        .singleElement()
        .satisfies(
            line -> {
              assertThat(line.moment()).isEqualTo(Moment.LOBBY);
              assertThat(line.text()).isIn("ready up", "which kit?", "gl all");
            });
  }

  @Test
  void aBurstOfHumanChatIsAnsweredWithinTheRateLimit() {
    var director = director();
    var answered = 0;
    for (var i = 0; i < 10; i++) {
      answered +=
          director
              .on(new ChatMoment.HumanSaid(ALICE, "hi"), lobby(List.of()), T0.plusMillis(i * 100L))
              .size();
    }

    // Three bots, each with a 20 s cooldown and a 1 s global gap: never more than one each.
    assertThat(answered).isBetween(1, 3);
  }

  @Test
  void theCountdownsEndGetsOneRemark() {
    var lines = director().on(new ChatMoment.CountdownCall(), lobby(List.of()), T0);

    assertThat(lines)
        .singleElement()
        .satisfies(
            line -> {
              assertThat(line.moment()).isEqualTo(Moment.LOBBY);
              assertThat(line.text()).doesNotContain("{");
            });
  }

  @Test
  void idleTimeInTheLobbyIsSmallTalkOrAJabAtARival() {
    var director = director();
    var later = T0.plusSeconds(3600);

    var talk = director.on(new ChatMoment.Idle(), lobby(List.of()), later);
    var jab = director().on(new ChatMoment.Idle(), lobby(List.of("bot-two")), later);

    assertThat(talk)
        .singleElement()
        .satisfies(line -> assertThat(line.moment()).isEqualTo(Moment.LOBBY));
    assertThat(jab)
        .singleElement()
        .satisfies(line -> assertThat(line.moment()).isIn(Moment.LOBBY, Moment.TAUNT));
  }

  @Test
  void greetingsAreRecognised() {
    for (var greeting : List.of("hi", "Hiii!", "hey guys", "hello", "yo", "sup", "o/", "  hiya")) {
      assertThat(ChatDirector.GREETING.matcher(greeting).matches()).as(greeting).isTrue();
    }
    for (var other : List.of("which kit", "this map", "high ground", "hint pls", "yoink")) {
      assertThat(ChatDirector.GREETING.matcher(other).matches()).as(other).isFalse();
    }
  }
}

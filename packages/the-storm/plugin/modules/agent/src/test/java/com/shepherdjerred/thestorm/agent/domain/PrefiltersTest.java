package com.shepherdjerred.thestorm.agent.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class PrefiltersTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");
  private static final PrefilterLimits LIMITS = new PrefilterLimits(5, 10, 400, 3, 20, 70);

  private static ChatSample line(String text) {
    return new ChatSample(ALICE, "Alice", text, NOW);
  }

  private static ChatSample line(String text, long secondsAgo) {
    return new ChatSample(ALICE, "Alice", text, NOW.minusSeconds(secondsAgo));
  }

  private static List<ChatSample> burst(String text, int count) {
    var lines = new ArrayList<ChatSample>();
    for (var i = 1; i <= count; i++) {
      lines.add(line(text + " " + i, i));
    }
    return List.copyOf(lines);
  }

  @Test
  void ordinaryChatPasses() {
    assertThat(Prefilters.check(line("hello everyone"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Allow());
  }

  @Test
  void floodsAct() {
    assertThat(Prefilters.check(line("x".repeat(401)), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Act(Offense.SPAM, "flood"));
    assertThat(Prefilters.check(line("x".repeat(400)), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Allow());
  }

  @Test
  void invitesAndIpsAct() {
    assertThat(Prefilters.check(line("join us discord.gg/abc123"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Act(Offense.ADVERTISING, "ad-pattern"));
    assertThat(Prefilters.check(line("DISCORD.GG/ABC123"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Act(Offense.ADVERTISING, "ad-pattern"));
    assertThat(Prefilters.check(line("play at 1.2.3.4:25565"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Act(Offense.ADVERTISING, "ad-pattern"));
    assertThat(Prefilters.check(line("my pin is 1.2.3"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Allow());
  }

  @Test
  void burstsActButOldLinesDoNotCount() {
    assertThat(Prefilters.check(line("again"), burst("spam", 5), LIMITS))
        .isEqualTo(new PrefilterVerdict.Act(Offense.SPAM, "rate"));
    assertThat(Prefilters.check(line("again"), burst("spam", 4), LIMITS))
        .isEqualTo(new PrefilterVerdict.Allow());

    var old = new ArrayList<ChatSample>();
    for (var i = 0; i < 10; i++) {
      old.add(line("old " + i, 60 + i));
    }
    assertThat(Prefilters.check(line("fresh"), old, LIMITS))
        .isEqualTo(new PrefilterVerdict.Allow());
  }

  @Test
  void repeatsAct() {
    var same = List.of(line("buy gold", 1), line("buy gold", 2), line("buy gold", 3));

    assertThat(Prefilters.check(line("buy gold"), same, LIMITS))
        .isEqualTo(new PrefilterVerdict.Act(Offense.SPAM, "repeat"));
    assertThat(Prefilters.check(line("buy gold"), same.subList(0, 2), LIMITS))
        .isEqualTo(new PrefilterVerdict.Allow());
  }

  @Test
  void capsLinksAndShoutingAskTheBrain() {
    assertThat(Prefilters.check(line("THIS IS ALL CAPS AND LONG ENOUGH"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Check("caps"));
    assertThat(Prefilters.check(line("SHORT CAPS"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Allow());
    assertThat(Prefilters.check(line("Mostly Lower With Some Caps Words"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Allow());

    assertThat(Prefilters.check(line("see https://example.com/a"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Check("url"));
    assertThat(Prefilters.check(line("what!!!!!"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Check("punct"));
    assertThat(Prefilters.check(line("what!!!"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Allow());
  }

  @Test
  void actingSignalsWinOverCheckingOnes() {
    assertThat(Prefilters.check(line("JOIN DISCORD.GG/ABC123 NOW"), List.of(), LIMITS))
        .isEqualTo(new PrefilterVerdict.Act(Offense.ADVERTISING, "ad-pattern"));
  }
}

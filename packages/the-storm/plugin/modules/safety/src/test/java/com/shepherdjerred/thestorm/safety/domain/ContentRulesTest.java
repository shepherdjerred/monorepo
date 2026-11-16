package com.shepherdjerred.thestorm.safety.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Test;

final class ContentRulesTest {
  @Test
  void linksLongMessagesAndCapsAreNotMisconduct() {
    for (var text :
        List.of(
            "HERE IS MY QUESTION",
            "a".repeat(16000),
            "https://example.com",
            "join my server",
            "discord.gg/friends")) {
      assertThat(ContentRules.obvious(text, List.of(), false)).isEmpty();
      assertThat(ContentRules.instantBlock(text, "Alice", ContentRules.RecentWindow.EMPTY, false))
          .isEmpty();
    }
  }

  @Test
  void repeatedLinksRequireThreeSeparateAttempts() {
    var line = "https://example.com";
    assertThat(ContentRules.obvious(line, List.of(line), false)).isEmpty();
    assertThat(ContentRules.obvious(line, List.of(line, line), false)).contains("spam");
    assertThat(
            ContentRules.instantBlock(
                line, "Alice", new ContentRules.RecentWindow(List.of(line), 1), false))
        .isEmpty();
    assertThat(
            ContentRules.instantBlock(
                "join " + line + " now",
                "Alice",
                new ContentRules.RecentWindow(List.of("visit " + line, "look " + line), 2),
                false))
        .contains(
            new ContentRules.InstantBlock(
                "spam", "Clear repeated-link spam or explicit slur.", true));
  }

  @Test
  void burstFloodBlocksWithoutAStrikeAtTwentyFourRecentMessages() {
    assertThat(
            ContentRules.instantBlock(
                "still chatting", "Alice", new ContentRules.RecentWindow(List.of(), 23), false))
        .isEmpty();
    assertThat(
            ContentRules.instantBlock(
                "flooding", "Alice", new ContentRules.RecentWindow(List.of(), 24), false))
        .contains(
            new ContentRules.InstantBlock(
                "spam", "Please slow down; ordinary conversation resumes shortly.", false));
  }

  @Test
  void explicitSlursMatchWordBoundariesAndEvidenceReportsAreExempt() {
    var slur = "n" + "igger";
    assertThat(ContentRules.obvious(slur, List.of(), false)).contains("hate");
    assertThat(ContentRules.obvious(slur.toUpperCase(Locale.ROOT), List.of(), false))
        .contains("hate");
    assertThat(ContentRules.obvious("snigger", List.of(), false)).isEmpty();
    assertThat(ContentRules.obvious("report: " + slur, List.of(), true)).isEmpty();
    assertThat(
            ContentRules.instantBlock(
                "report: " + slur, "Alice", ContentRules.RecentWindow.EMPTY, true))
        .isEmpty();
  }

  @Test
  void stageOneBlocksEgregiousHateSelfHarmCsamAndDoxxingVariants() {
    var hateExamples =
        List.of(
            "n" + "igger",
            "n1gg3r",
            "n.i.g.g.e.r",
            "you are a n i g g e r",
            "f" + "aggot",
            "f4gg0t",
            "f.a.g.g.o.t",
            "k" + "ike",
            "k1k3",
            "t" + "ranny",
            "tr4nny",
            "c" + "hink",
            "ch1nk",
            "s" + "pic",
            "sp1cs",
            "w" + "etback",
            "g" + "ook",
            "r" + "aghead",
            "heil hitler",
            "1488",
            "gas the jews");
    for (var sample : hateExamples) {
      var decision =
          ContentRules.instantBlock(sample, "Alice", ContentRules.RecentWindow.EMPTY, false);
      assertThat(decision)
          .as("expected instant hate block for: %s", sample)
          .isPresent()
          .get()
          .satisfies(block -> {
            assertThat(block.category()).isEqualTo("hate");
            assertThat(block.applyStrike()).isTrue();
          });
    }

    for (var sample :
        List.of(
            "kys",
            "k.y.s",
            "go k y s",
            "kill yourself",
            "go hang yourself",
            "slit your wrists",
            "ssn: 123-45-6789",
            "here is your home address")) {
      var decision =
          ContentRules.instantBlock(sample, "Alice", ContentRules.RecentWindow.EMPTY, false);
      assertThat(decision)
          .as("expected instant harassment block for: %s", sample)
          .isPresent()
          .get()
          .satisfies(block -> {
            assertThat(block.category()).isEqualTo("harassment");
            assertThat(block.applyStrike()).isTrue();
          });
    }

    var csam =
        ContentRules.instantBlock(
            "child p" + "orn", "Alice", ContentRules.RecentWindow.EMPTY, false);
    assertThat(csam)
        .isPresent()
        .get()
        .satisfies(block -> {
          assertThat(block.category()).isEqualTo("threat");
          assertThat(block.applyStrike()).isTrue();
        });
  }

  @Test
  void mildSwearingAndScunthorpeWordsPassStageOne() {
    var allowed =
        List.of(
            "fuck",
            "shit",
            "damn",
            "hell",
            "ass",
            "bitch",
            "wtf",
            "lmao",
            "crap",
            "wtf that boss hit like shit lmao",
            "fuck yeah nice clutch",
            "go ok",
            "assassin",
            "classic",
            "scrap",
            "snigger",
            "grape",
            "therapist",
            "spicy",
            "analyze",
            "kumquat",
            "cockpit",
            "racoon",
            "night",
            "knight",
            "keys",
            "sky",
            "kiss",
            "think",
            "bike",
            "base at 14880 64 -320");
    for (var sample : allowed) {
      assertThat(ContentRules.instantBlock(sample, "Alice", ContentRules.RecentWindow.EMPTY, false))
          .as("expected Stage 1 to allow: %s", sample)
          .isEmpty();
    }
  }

  @Test
  void credentialsAndAuthCommandsBlockImmediatelyWithNoStrike() {
    for (var sample :
        List.of(
            "my key is sk-proj-" + "x".repeat(32),
            "password=supersecretpassword123",
            "/login hunter2secret",
            "/discordlink 123456")) {
      assertThat(ContentRules.instantBlock(sample, "Alice", ContentRules.RecentWindow.EMPTY, true))
          .contains(
              new ContentRules.InstantBlock(
                  "none",
                  "Remove credential-shaped content before publishing. No misconduct strike was recorded.",
                  false));
    }
  }

  @Test
  void overlappingWindowsPreserveEveryCodePoint() {
    var text = "a".repeat(3998) + "😀" + "b".repeat(8000);
    var windows = ContentRules.windows(text);
    assertThat(windows)
        .allSatisfy(window ->
            assertThat(window.codePointCount(0, window.length())).isLessThanOrEqualTo(4000));
    assertThat(windows.get(0)).contains("😀");
    assertThat(windows.get(1)).contains("😀");
    assertThat(windows.getLast()).endsWith("b".repeat(100));
  }

  @Test
  void credentialsAreRedactedBeforePersistenceOrExternalClassification() {
    assertThat(ContentRules.redact("key sk-proj-" + "x".repeat(64)))
        .isEqualTo("key [credential redacted]");
  }

  @Test
  void nonProseGameplayCommandsRemainAvailableToMutedPlayers() {
    for (var command :
        List.of(
            "/arena join rustworks",
            "/thestorm:arena leave",
            "/rtp plains",
            "/rwf join",
            "/survival classes",
            "/kit starter")) {
      var content = CommandContent.parse(command);
      assertThat(content.surface()).isEqualTo("command");
      assertThat(content.screen()).isFalse();
    }
    assertThat(CommandContent.parse("/nick new nickname").screen()).isTrue();
    assertThat(CommandContent.parse("/unknown-plugin authored prose").screen()).isTrue();
  }

  @Test
  void recipientNamesAndAuthArgumentsAreNotModeratedAsAuthoredProse() {
    assertThat(CommandContent.parse("/minecraft:msg badname hello").text()).isEqualTo("hello");
    assertThat(CommandContent.parse("/minecraft:msg badname hello").surface()).isEqualTo("message");
    assertThat(CommandContent.parse("/discord link private-code").text())
        .doesNotContain("private-code");
    assertThat(CommandContent.parse("/tp Bob").screen()).isFalse();
    assertThat(CommandContent.parse("/g hello").screen()).isTrue();
  }
}

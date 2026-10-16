package com.shepherdjerred.thestorm.safety.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
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
            "discord.gg/friends"))
      assertThat(ContentRules.obvious(text, List.of(), false)).isEmpty();
  }

  @Test
  void repeatedLinksRequireThreeSeparateAttempts() {
    var line = "https://example.com";
    assertThat(ContentRules.obvious(line, List.of(line), false)).isEmpty();
    assertThat(ContentRules.obvious(line, List.of(line, line), false)).contains("spam");
  }

  @Test
  void explicitSlursMatchWordBoundariesAndEvidenceReportsAreExempt() {
    var slur = "n" + "igger";
    assertThat(ContentRules.obvious(slur, List.of(), false)).contains("hate");
    assertThat(ContentRules.obvious(slur.toUpperCase(java.util.Locale.ROOT), List.of(), false))
        .contains("hate");
    assertThat(ContentRules.obvious("snigger", List.of(), false)).isEmpty();
    assertThat(ContentRules.obvious("report: " + slur, List.of(), true)).isEmpty();
  }

  @Test
  void overlappingWindowsPreserveEveryCodePoint() {
    var text = "a".repeat(3998) + "😀" + "b".repeat(8000);
    var windows = ContentRules.windows(text);
    assertThat(windows)
        .allSatisfy(
            window ->
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
  void recipientNamesAndAuthArgumentsAreNotModeratedAsAuthoredProse() {
    assertThat(CommandContent.parse("/minecraft:msg badname hello").text()).isEqualTo("hello");
    assertThat(CommandContent.parse("/minecraft:msg badname hello").surface()).isEqualTo("message");
    assertThat(CommandContent.parse("/discord link private-code").text())
        .doesNotContain("private-code");
    assertThat(CommandContent.parse("/tp Bob").screen()).isFalse();
    assertThat(CommandContent.parse("/g hello").screen()).isTrue();
  }
}

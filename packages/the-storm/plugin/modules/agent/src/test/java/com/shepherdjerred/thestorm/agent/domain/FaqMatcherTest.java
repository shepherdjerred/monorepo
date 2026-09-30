package com.shepherdjerred.thestorm.agent.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

final class FaqMatcherTest {

  private static final FaqEntry KIT =
      new FaqEntry("starter-kit", List.of("starter kit"), "You get a kit.", "");
  private static final FaqEntry RULES =
      new FaqEntry("server-rules", List.of("rules", "starter kit"), "Read /rules.", "");

  @Test
  void matchesKeywordsCaseInsensitively() {
    assertThat(FaqMatcher.match("Where is my STARTER KIT?", List.of(KIT, RULES))).contains(KIT);
  }

  @Test
  void firstMatchInCatalogOrderWins() {
    assertThat(FaqMatcher.match("starter kit", List.of(RULES, KIT))).contains(RULES);
  }

  @Test
  void missesWithoutAKeyword() {
    assertThat(FaqMatcher.match("someone broke my wall", List.of(KIT, RULES))).isEmpty();
  }

  @Test
  void blankKeywordsNeverMatch() {
    var blank = new FaqEntry("blank", List.of("  "), "Unreachable.", "");

    assertThat(FaqMatcher.match("anything at all", List.of(blank))).isEmpty();
  }
}

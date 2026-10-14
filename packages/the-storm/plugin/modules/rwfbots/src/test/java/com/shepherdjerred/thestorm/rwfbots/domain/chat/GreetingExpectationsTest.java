package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.domain.FilterSettings;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class GreetingExpectationsTest {
  private static final List<String> POOL =
      List.of("WHO IS READY TO RUSH. me. i am.", "{team} lets GO GO GO", "hello");

  @Test
  void lobbyExpectationsApplyChatCapsRulesAndExcludeUnavailableTeamTemplates() {
    assertThat(
            GreetingExpectations.rendered(POOL, Optional.empty(), new FilterSettings(256, 4, 30)))
        .containsExactly("who is ready to rush. me. i am.", "hello");
  }

  @Test
  void expectationsUseTheCurrentDisplayTeamWhenItsPlaceholderIsAvailable() {
    assertThat(
            GreetingExpectations.rendered(
                POOL, Optional.of("Red Team"), new FilterSettings(256, 4, 30)))
        .containsExactly("who is ready to rush. me. i am.", "Red Team lets GO GO GO", "hello");
  }
}

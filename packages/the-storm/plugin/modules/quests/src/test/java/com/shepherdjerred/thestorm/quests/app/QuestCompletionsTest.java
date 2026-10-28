package com.shepherdjerred.thestorm.quests.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import org.junit.jupiter.api.Test;

final class QuestCompletionsTest {

  @Test
  void storySideAndTrackCountAndBoardQuestsDoNot() {
    assertThat(QuestCompletions.counts(Quest.Category.STORY)).isTrue();
    assertThat(QuestCompletions.counts(Quest.Category.SIDE)).isTrue();
    assertThat(QuestCompletions.counts(Quest.Category.TRACK)).isTrue();
    assertThat(QuestCompletions.counts(Quest.Category.DAILY)).isFalse();
    assertThat(QuestCompletions.counts(Quest.Category.WEEKLY)).isFalse();
    assertThat(QuestCompletions.counts(Quest.Category.HIDDEN)).isFalse();
  }
}

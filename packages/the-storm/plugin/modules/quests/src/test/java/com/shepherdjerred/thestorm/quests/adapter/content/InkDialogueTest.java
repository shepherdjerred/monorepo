package com.shepherdjerred.thestorm.quests.adapter.content;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.context;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.empty;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.sim.ScriptedFacts;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class InkDialogueTest {

  @TempDir Path directory;

  private void script(String source) throws IOException {
    var dialogue = directory.resolve("quests/dialogue");
    Files.createDirectories(dialogue);
    Files.writeString(dialogue.resolve("sample.ink"), source);
  }

  @Test
  void choicePointsFailAtStartup() throws IOException {
    script(
        """
        === sample ===
        Hello.
        * [Choose]
          Chosen.
          -> END
        """);

    assertThatThrownBy(() -> InkDialogue.load(directory, QuestContent.empty()))
        .hasStackTraceContaining("Ink dialogue cannot contain choices");
  }

  @Test
  void includesFailAtStartup() throws IOException {
    script(
        """
        INCLUDE other.ink
        === sample ===
        Hello.
        -> END
        """);

    assertThatThrownBy(() -> InkDialogue.load(directory, QuestContent.empty()))
        .hasStackTraceContaining("Ink INCLUDE is not supported: other.ink");
  }

  @Test
  void largeQuestNumbersRenderWithoutNarrowing() throws IOException {
    script(
        """
        EXTERNAL quest_variable(name)
        EXTERNAL quest_reputation(name)
        EXTERNAL quest_points()
        === sample ===
        Values {quest_variable("count")}, {quest_reputation("town")}, {quest_points()}.
        -> END
        """);
    var state =
        empty()
            .withVariable("count", 3_000_000_000L)
            .withReputation("town", 4_000_000_000L)
            .withPoints(5_000_000_000L);

    var dialogue = InkDialogue.load(directory, QuestContent.empty());

    assertThat(dialogue.render("ink:sample#sample", state, context(new ScriptedFacts())))
        .isEqualTo("Values 3000000000, 4000000000, 5000000000.");
  }
}

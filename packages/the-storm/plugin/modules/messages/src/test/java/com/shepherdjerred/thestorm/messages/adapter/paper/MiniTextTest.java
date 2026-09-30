package com.shepherdjerred.thestorm.messages.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class MiniTextTest {

  @ParameterizedTest
  @ValueSource(
      strings = {
        "<#4DCCC4>The Storm</#4DCCC4> <dark_gary>//</dark_gary>",
        "<gray>fine</gray> <bolt>typo</bolt>",
        "<gren>hi</gren>",
        "hi <nope>"
      })
  void rejectsUnrecognizedTags(String text) {
    assertThatThrownBy(() -> MiniText.parse(text, "tips"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("tips");
  }

  @Test
  void rejectsUnclosedTagsInStrictMode() {
    assertThatThrownBy(() -> MiniText.parse("<gray>never closed", "motd top"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("motd top");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "<#4DCCC4><bold>The Storm</bold></#4DCCC4> <dark_gray>//</dark_gray> <gray>Survival</gray>",
        "<gray>Why is it always raining?</gray><newline><#4DCCC4>ts-mc.net</#4DCCC4>",
        "<green>hi</green>",
        "plain text with a heart <3"
      })
  void acceptsValidText(String text) {
    assertThat(MiniText.parse(text, "tab.footer")).isNotNull();
  }

  @Test
  void rendersTheTextWithoutItsTags() {
    var component =
        MiniText.parse("<gray>Why is it always <#4DCCC4>raining</#4DCCC4>?</gray>", "x");

    assertThat(PlainTextComponentSerializer.plainText().serialize(component))
        .isEqualTo("Why is it always raining?");
  }
}

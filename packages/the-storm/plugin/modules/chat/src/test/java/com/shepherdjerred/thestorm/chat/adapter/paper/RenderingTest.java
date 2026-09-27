package com.shepherdjerred.thestorm.chat.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.domain.ChannelAccess;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.chat.domain.ChatFormat;
import com.shepherdjerred.thestorm.chat.domain.MiniMessageText;
import com.shepherdjerred.thestorm.chat.domain.ProfileError;
import java.time.Duration;
import java.util.Arrays;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Proves the domain's escaping against the real MiniMessage parser. */
final class RenderingTest {

  private static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "<red>red</red>",
        "<click:run_command:'/op me'>free diamonds</click>",
        "<hover:show_text:'<obf>x'>hover</hover>",
        "\\<red> already escaped",
        "trailing backslash \\",
        "\\\\<bold>double",
        "<reset><newline><br>",
        "a < b > c",
        "<#ff0000>hex</#ff0000> <rainbow>r</rainbow> <font:uniform>f</font>",
        "<insert:x>i</insert> <key:key.jump> <lang:block.minecraft.stone>",
      })
  void escapedTextRendersLiterally(String hostile) {
    var component = MiniMessage.miniMessage().deserialize(MiniMessageText.escape(hostile));

    assertThat(plain(component)).isEqualTo(hostile);
    assertThat(component.clickEvent()).isNull();
    assertThat(component.hoverEvent()).isNull();
  }

  @Test
  void aFormattedLineKeepsItsStyleButNotThePlayers() {
    var template =
        ChatFormat.channelTemplate(
            "<dark_gray>[<dark_green>G</dark_green>][<prefix><white><player></white>]: </dark_gray>"
                + "<gray><message>");

    var component =
        MiniMessage.miniMessage()
            .deserialize(
                ChatFormat.channelLine(
                    template, "<gold>Mage</gold>", "Jerred", "<click:open_url:x>hi</click>"));

    assertThat(plain(component)).isEqualTo("[G][Mage Jerred]: <click:open_url:x>hi</click>");
    assertThat(component.children()).allSatisfy(child -> assertThat(child.clickEvent()).isNull());
  }

  @Test
  void everyDenialAndErrorHasAMessage() {
    assertThat(Feedback.describe(new ChatDenial.Repeated(Duration.ofSeconds(5)))).contains("5s");
    assertThat(Feedback.describe(new ChatDenial.Muted(Duration.ofMinutes(2), "spam")))
        .isEqualTo("You are muted for 2m: spam");
    assertThat(Feedback.describe(ChannelKey.TOWN, ChannelAccess.UNAVAILABLE))
        .isEqualTo("Towns are not available yet, so there is no town chat.");
    assertThat(Feedback.describe(ChannelKey.TOWN, ChannelAccess.NOT_A_MEMBER))
        .isEqualTo("You are not in a town.");
    assertThat(Arrays.stream(ProfileError.values()).map(Feedback::describe))
        .doesNotContainNull()
        .doesNotHaveDuplicates();
  }

  @Test
  void channelCommandsAreDistinct() {
    assertThat(Arrays.stream(ChannelKey.values()).map(ChatCommands::label))
        .containsExactly("g", "war", "sc", "tc");
    assertThat(ChatCommands.labels(ChannelKey.WAR)).containsExactly("war", "wc");
  }

  @Test
  void whisperOwnsSlashW() {
    var channelLabels =
        Arrays.stream(ChannelKey.values()).flatMap(key -> ChatCommands.labels(key).stream());

    assertThat(PrivateCommands.MESSAGE_LABELS).containsExactly("msg", "tell", "whisper", "w");
    assertThat(channelLabels).doesNotContainAnyElementsOf(PrivateCommands.MESSAGE_LABELS);
  }

  @Test
  void privateDenialsDoNotRevealIgnores() {
    assertThat(Feedback.describe(new ChatDenial.Undeliverable()))
        .isEqualTo("Message not delivered.");
    assertThat(Feedback.describe(new ChatDenial.ToSelf()))
        .isEqualTo("You cannot message yourself.");
  }
}

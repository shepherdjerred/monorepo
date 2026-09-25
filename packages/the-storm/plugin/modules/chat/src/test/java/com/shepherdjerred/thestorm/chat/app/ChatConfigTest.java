package com.shepherdjerred.thestorm.chat.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

final class ChatConfigTest {

  /** The file the server runs with, relative to this module's directory. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/chat.yml");

  private static Result<ChatConfig, List<Problem>> parse(String yaml) {
    return StrictYaml.parse("chat.yml", yaml, ChatConfig.class);
  }

  private static String problems(Result<ChatConfig, List<Problem>> result) {
    return switch (result) {
      case Result.Ok<ChatConfig, List<Problem>>(var value) ->
          throw new AssertionError("expected problems, parsed " + value);
      case Result.Err<ChatConfig, List<Problem>>(var problems) -> problems.toString();
    };
  }

  @Test
  void theShippedFileIsValid() throws Exception {
    var config =
        switch (parse(Files.readString(SHIPPED))) {
          case Result.Ok<ChatConfig, List<Problem>>(var value) -> value;
          case Result.Err<ChatConfig, List<Problem>>(var problems) ->
              throw new AssertionError(problems.toString());
        };

    assertThat(config.defaultChannelKey()).isEqualTo(ChannelKey.GLOBAL);
    for (var channel : ChannelKey.values()) {
      assertThat(config.channels().template(channel).source()).contains("<message>");
    }
  }

  @Test
  void rejectsAClosedDefaultChannel() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("defaultChannel: global", "defaultChannel: staff");

    assertThat(problems(parse(yaml))).contains("open to everyone");
  }

  @Test
  void rejectsAFormatWithoutTheMessage() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("<gray><message>\"\n  war", "\"\n  war");

    assertThat(problems(parse(yaml))).contains("<message>");
  }

  @Test
  void rejectsUnknownKeys() throws Exception {
    assertThat(parse(Files.readString(SHIPPED) + "colour: teal\n").isOk()).isFalse();
  }
}

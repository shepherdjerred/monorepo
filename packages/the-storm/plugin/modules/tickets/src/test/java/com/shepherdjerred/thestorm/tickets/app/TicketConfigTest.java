package com.shepherdjerred.thestorm.tickets.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

final class TicketConfigTest {

  /** The file the server runs with, relative to this module's directory. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/tickets.yml");

  private static Result<TicketConfig, List<Problem>> parse(String yaml) {
    return StrictYaml.parse("tickets.yml", yaml, TicketConfig.class);
  }

  private static String problems(Result<TicketConfig, List<Problem>> result) {
    return switch (result) {
      case Result.Ok<TicketConfig, List<Problem>>(var value) ->
          throw new AssertionError("expected problems, parsed " + value);
      case Result.Err<TicketConfig, List<Problem>>(var problems) -> problems.toString();
    };
  }

  @Test
  void theShippedFileIsValid() throws Exception {
    var config =
        switch (parse(Files.readString(SHIPPED))) {
          case Result.Ok<TicketConfig, List<Problem>>(var value) -> value;
          case Result.Err<TicketConfig, List<Problem>>(var problems) ->
              throw new AssertionError(problems.toString());
        };

    assertThat(config.pageSize()).isEqualTo(10);
    assertThat(config.serverId()).isEqualTo("survival");
  }

  @Test
  void rejectsABadPageSize() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("pageSize: 10", "pageSize: 0");

    assertThat(problems(parse(yaml))).contains("pageSize must be 1-50");
  }

  @Test
  void rejectsABadServerId() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("serverId: survival", "serverId: Survival!");

    assertThat(problems(parse(yaml))).contains("serverId must be 1-32");
  }
}

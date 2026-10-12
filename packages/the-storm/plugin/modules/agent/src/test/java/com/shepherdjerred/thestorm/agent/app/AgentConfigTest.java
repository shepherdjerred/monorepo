package com.shepherdjerred.thestorm.agent.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.agent.domain.LadderAction;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

final class AgentConfigTest {

  /** The file the server runs with, relative to this module's directory. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/agent.yml");

  private static final String BRAIN_BASE_URL =
      "http://storm-brain-storm-brain-service.storm-brain.svc.cluster.local:3000";

  private static Result<AgentConfig, List<Problem>> parse(String yaml) {
    return StrictYaml.parse("agent.yml", yaml, AgentConfig.class);
  }

  private static AgentConfig ok(Result<AgentConfig, List<Problem>> result) {
    return switch (result) {
      case Result.Ok<AgentConfig, List<Problem>>(var value) -> value;
      case Result.Err<AgentConfig, List<Problem>>(var problems) ->
          throw new AssertionError(problems.toString());
    };
  }

  private static String problems(Result<AgentConfig, List<Problem>> result) {
    return switch (result) {
      case Result.Ok<AgentConfig, List<Problem>>(var value) ->
          throw new AssertionError("expected problems, parsed " + value);
      case Result.Err<AgentConfig, List<Problem>>(var problems) -> problems.toString();
    };
  }

  @Test
  void theShippedFileIsValid() throws Exception {
    var config = ok(parse(Files.readString(SHIPPED)));

    assertThat(config.reviewSamplePercent()).isEqualTo(10);
    assertThat(config.shadow()).isFalse();
    assertThat(config.classifyThreshold()).isEqualTo(0.8);
    assertThat(config.triageThreshold()).isEqualTo(0.7);
    assertThat(config.resolveThreshold()).isEqualTo(0.95);
    assertThat(config.brain().baseUrl()).isEqualTo(BRAIN_BASE_URL);
    assertThat(config.brain().bearerTokenEnv()).isEqualTo("STORM_BRAIN_BEARER_TOKEN");
    assertThat(config.brain().timeoutMs()).isEqualTo(65_000);
    assertThat(config.sweep().intervalMinutes()).isEqualTo(15);
    assertThat(config.sweep().redriveAfterMinutes()).isEqualTo(10);
    assertThat(config.sweep().redriveBackoffMinutes()).isEqualTo(60);
    assertThat(config.sweep().slaAfterMinutes()).isEqualTo(240);
    assertThat(config.limits().maxLines()).isEqualTo(5);
    var table = config.table();
    for (var offense : Offense.values()) {
      if (offense == Offense.OTHER) {
        // Bookkeeping cases are never laddered.
        assertThat(table.ladder(offense)).isEmpty();
      } else {
        assertThat(table.ladder(offense)).isPresent();
      }
    }
    var spam = table.ladder(Offense.SPAM).orElseThrow();
    assertThat(spam.evaluate(0).action()).isEqualTo(LadderAction.MUTE);
    assertThat(spam.evaluate(0).length()).contains(Duration.ofMinutes(10));
    assertThat(config.serverId()).isEqualTo("survival");
    assertThat(config.faq().enabled()).isTrue();
    assertThat(config.faq().halfLifeHours()).isEqualTo(168);
    assertThat(config.faq().entries())
        .extracting(entry -> entry.id())
        .containsExactly("starter-kit", "server-rules", "report-grief");
    assertThat(config.onboarding().enabled()).isTrue();
    assertThat(config.onboarding().lines()).hasSize(4);
  }

  @Test
  void rejectsAnUnknownOffense() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("offense: spam", "offense: littering");

    assertThat(problems(parse(yaml))).contains("unknown offense");
  }

  @Test
  void rejectsAMuteWithoutADuration() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("duration: 10m", "duration: none");

    assertThat(problems(parse(yaml))).contains("must name a duration");
  }

  @Test
  void rejectsAWarnWithADuration() throws Exception {
    var yaml =
        Files.readString(SHIPPED)
            .replace("{ action: warn, duration: none }", "{ action: warn, duration: 10m }");

    assertThat(problems(parse(yaml))).contains("must not name a duration");
  }

  @Test
  void rejectsABadWindow() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("repeatWithin: 7d", "repeatWithin: soon");

    assertThat(problems(parse(yaml))).contains("window");
  }

  @Test
  void rejectsADuplicateOffense() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("offense: theft", "offense: grief");

    assertThat(problems(parse(yaml))).contains("duplicate ladder");
  }

  @Test
  void rejectsABadSampleRate() throws Exception {
    var yaml =
        Files.readString(SHIPPED).replace("reviewSamplePercent: 10", "reviewSamplePercent: 101");

    assertThat(problems(parse(yaml))).contains("0-100");
  }

  @Test
  void rejectsABadMode() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("mode: active", "mode: armed");

    assertThat(problems(parse(yaml))).contains("mode must be shadow or active");
  }

  @Test
  void rejectsAZeroThreshold() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("classifyThreshold: 0.8", "classifyThreshold: 0");

    assertThat(problems(parse(yaml))).contains("classifyThreshold must be above 0 through 1");
  }

  @Test
  void rejectsBadPrefilterLimits() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("capsPercent: 70", "capsPercent: 101");

    assertThat(problems(parse(yaml))).contains("capsPercent must be 1-100");
  }

  @Test
  void rejectsABadBrainUrl() throws Exception {
    var yaml =
        Files.readString(SHIPPED)
            .replace("baseUrl: " + BRAIN_BASE_URL, "baseUrl: storm-brain:3000");

    assertThat(problems(parse(yaml))).contains("must be an http(s) URL");
  }

  @Test
  void rejectsABadBrainTokenEnv() throws Exception {
    var yaml =
        Files.readString(SHIPPED)
            .replace("bearerTokenEnv: STORM_BRAIN_BEARER_TOKEN", "bearerTokenEnv: brain token");

    assertThat(problems(parse(yaml))).contains("must name an environment variable");
  }

  @Test
  void rejectsABadBrainTimeout() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("timeoutMs: 65000", "timeoutMs: 500");

    assertThat(problems(parse(yaml))).contains("timeoutMs must be 1000-300000");
  }

  @Test
  void rejectsABadSweepInterval() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("intervalMinutes: 15", "intervalMinutes: 0");

    assertThat(problems(parse(yaml))).contains("sweep.intervalMinutes must be 1-1440");
  }

  @Test
  void rejectsABadSweepSla() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("slaAfterMinutes: 240", "slaAfterMinutes: -1");

    assertThat(problems(parse(yaml))).contains("sweep.slaAfterMinutes must be 0-10080");
  }

  @Test
  void rejectsABadServerId() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("serverId: survival", "serverId: Survival!");

    assertThat(problems(parse(yaml))).contains("serverId must be 1-32");
  }

  @Test
  void rejectsADuplicateFaqEntry() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("- id: server-rules", "- id: starter-kit");

    assertThat(problems(parse(yaml))).contains("duplicate faq entry");
  }

  @Test
  void rejectsABadFaqHalfLife() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("halfLifeHours: 168", "halfLifeHours: 0");

    assertThat(problems(parse(yaml))).contains("faq.halfLifeHours must be 1-720");
  }

  @Test
  void rejectsABlankFaqReply() throws Exception {
    var yaml =
        Files.readString(SHIPPED)
            .replace(
                "reply: \"The rules live in game: run /rules to read them.\"", "reply: \"  \"");

    assertThat(problems(parse(yaml))).contains("reply must be 1-1000 characters");
  }

  @Test
  void rejectsEnabledOnboardingWithoutLines() {
    assertThatThrownBy(() -> new AgentConfig.OnboardingFile(true, List.of()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("at least one line");
  }

  @Test
  void rejectsUnknownKeys() throws Exception {
    var yaml =
        Files.readString(SHIPPED)
            .replace("reviewSamplePercent: 10", "reviewSamplePercent: 10\nbogus: 1");

    assertThat(problems(parse(yaml))).contains("bogus");
  }
}

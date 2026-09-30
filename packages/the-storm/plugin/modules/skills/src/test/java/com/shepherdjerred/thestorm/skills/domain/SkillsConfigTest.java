package com.shepherdjerred.thestorm.skills.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import org.junit.jupiter.api.Test;

final class SkillsConfigTest {

  @Test
  void parsesStrictly() {
    var parsed =
        StrictYaml.parse(
            "skills.yml",
            "leaderboardSize: 10\nacrobaticsCooldownSeconds: 60\n",
            SkillsConfig.class);
    assertThat(parsed).isEqualTo(Result.ok(new SkillsConfig(10, 60)));
    assertThat(
            StrictYaml.parse(
                "skills.yml",
                "leaderboardSize: 10\nacrobaticsCooldownSeconds: 60\nunknown: true\n",
                SkillsConfig.class))
        .isInstanceOf(Result.Err.class);
    assertThat(StrictYaml.parse("skills.yml", "leaderboardSize: 10\n", SkillsConfig.class))
        .isInstanceOf(Result.Err.class);
  }
}

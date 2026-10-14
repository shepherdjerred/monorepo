package com.shepherdjerred.thestorm.rwf.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.app.ExperienceSettings;
import org.junit.jupiter.api.Test;

final class ExperienceConfigTest {
  private static final String VALID =
      """
      difficulty: hard
      style: varied
      variety: high
      maps: []
      kits: []
      """;

  @Test
  void shippedDefaultsAreStrictTypedValues() {
    assertThat(StrictYaml.parse("experience", VALID, ExperienceSettings.class))
        .isEqualTo(new Result.Ok<>(ExperienceSettings.DEFAULT));
  }

  @Test
  void unknownOrMissingSettingsFailRatherThanFallingBack() {
    for (var invalid :
        new String[] {
          VALID.replace("hard", "impossible"),
          VALID.replace("varied", "randomly-broken"),
          VALID.replace("high", "extreme"),
          VALID.replace("difficulty: hard\n", ""),
          VALID.replace("maps: []", "maps: [../world]"),
          VALID.replace("kits: []\n", ""),
          VALID + "extra: true\n"
        }) {
      assertThat(StrictYaml.parse("experience", invalid, ExperienceSettings.class))
          .as(invalid)
          .isInstanceOf(Result.Err.class);
    }
  }
}

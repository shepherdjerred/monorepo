package com.shepherdjerred.thestorm.skytravel.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

final class LaunchConfigTest {
  @Test
  void sharedCatalogHasEverySurveyedSiteExactlyOnce() throws Exception {
    var path = Path.of("../../../server/owned/plugins/TheStorm/skytravel.json");
    var config =
        StrictYaml.parseJson(path.toString(), Files.readString(path), LaunchConfig.class)
            .fold(
                value -> value,
                problems -> {
                  throw new AssertionError(problems);
                });
    assertThat(config.world()).isEqualTo("skylands");
    assertThat(config.apex()).isEqualTo(480);
    assertThat(config.towers())
        .extracting(LaunchConfig.Tower::id)
        .containsExactly(
            "H", "I1", "I2", "I3", "I4", "I5", "I6", "O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8",
            "O9", "O10", "O11", "O12");
  }

  @Test
  void buttonCanOnlyLaunchSomeoneStandingOnItsOwnPad() {
    var tower = tower("H", 10);
    assertThat(tower.onPad(10.5, 189, 74.5)).isTrue();
    assertThat(tower.onPad(9, 189, 73)).isTrue();
    assertThat(tower.onPad(12, 189, 74)).isFalse();
    assertThat(tower.onPad(10, 188, 74)).isFalse();
    assertThat(tower.onPad(10, 191, 74)).isFalse();
  }

  @Test
  void duplicateIdsOrControlsFailAtStartup() {
    var first = tower("H", 10);
    assertThatThrownBy(() -> config(List.of(first, first)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> config(List.of(first, tower("I1", 10))))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void finalDescentCannotBeConfiguredAsUnlimitedImmunity() {
    assertThatThrownBy(() -> new LaunchConfig("skylands", 480, 120, 31, 2, 15, List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private static LaunchConfig config(List<LaunchConfig.Tower> towers) {
    return new LaunchConfig("skylands", 480, 120, 30, 2, 15, towers);
  }

  private static LaunchConfig.Tower tower(String id, int x) {
    return new LaunchConfig.Tower(
        id,
        false,
        new LaunchConfig.Block(x, 165, 74),
        new LaunchConfig.Block(x, 189, 74),
        new LaunchConfig.Block(x + 2, 190, 74),
        List.of(new LaunchConfig.Block(x, 165, 62)));
  }
}

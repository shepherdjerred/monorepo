package com.shepherdjerred.thestorm.arena.domain.survival;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class SurvivalBuildTest {
  @Test
  void pathsRequireFourthClearAndCannotCrossClassesOrChangeOnceChosen() {
    var build = new SurvivalBuild(SurvivalClass.FIGHTER);
    build.cleared(3);
    assertThat(build.select(Specialization.GUARDIAN)).isFalse();
    build.cleared(4);
    assertThat(build.pending()).isEqualTo(1);
    assertThat(build.select(Specialization.FIELD_SURGEON)).isFalse();
    assertThat(build.select(Specialization.GUARDIAN)).isTrue();
    assertThat(build.select(Specialization.VANGUARD)).isFalse();
    assertThat(build.pending()).isZero();
    assertThat(build.upgrade(SurvivalBuild.Upgrade.TEMPO)).isFalse();
    assertThat(build.nextMilestone()).isEqualTo(9);
  }

  @Test
  void debugMilestonesAllowAllChoicesButNeverMoreThanThree() {
    var build = new SurvivalBuild(SurvivalClass.RANGER);
    build.cleared(14);
    assertThat(build.pending()).isEqualTo(3);
    assertThat(build.upgrade(SurvivalBuild.Upgrade.POTENCY)).isFalse();
    assertThat(build.select(Specialization.MARKSMAN)).isTrue();
    assertThat(build.upgrade(SurvivalBuild.Upgrade.POTENCY)).isTrue();
    assertThat(build.upgrade(SurvivalBuild.Upgrade.TEMPO)).isTrue();
    assertThat(build.upgrade(SurvivalBuild.Upgrade.TEMPO)).isFalse();
    build.cleared(1000);
    build.cleared(2);
    assertThat(build.pending()).isZero();
    assertThat(build.nextMilestone()).isZero();
    assertThat(build.cooldownSeconds()).isEqualTo(34);
    assertThat(build.magnitude(8)).isEqualTo(10);
    assertThat(build.utilitySeconds(6)).isEqualTo(8);
    var freshRun = new SurvivalBuild(SurvivalClass.RANGER);
    assertThat(freshRun.specialization()).isEmpty();
    assertThat(freshRun.pending()).isZero();
  }
}

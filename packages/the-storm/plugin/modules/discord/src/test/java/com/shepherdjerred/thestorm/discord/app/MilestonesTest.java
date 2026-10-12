package com.shepherdjerred.thestorm.discord.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

final class MilestonesTest {

  private final Milestones milestones = new Milestones(List.of(25, 50), 100);

  @Test
  void aSkillMilestoneIsTheHighestMultipleCrossed() {
    assertThat(milestones.skillMilestone(98, 99)).isZero();
    assertThat(milestones.skillMilestone(99, 100)).isEqualTo(100);
    assertThat(milestones.skillMilestone(100, 101)).isZero();
    assertThat(milestones.skillMilestone(150, 320)).isEqualTo(300);
  }

  @Test
  void townClaimsMustRise() {
    assertThatThrownBy(() -> new Milestones(List.of(50, 25), 100))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Milestones(List.of(1), 100))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Milestones(List.of(), 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}

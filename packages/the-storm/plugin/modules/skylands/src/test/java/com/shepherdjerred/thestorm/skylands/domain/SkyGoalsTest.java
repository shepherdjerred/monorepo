package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashSet;
import org.junit.jupiter.api.Test;

final class SkyGoalsTest {
  @Test
  void indexMatchesExhaustiveManhattanDistanceAcrossSeveralTiers() {
    var points = new LinkedHashSet<SkyPosition>();
    for (var i = 0; i < 300; i++)
      points.add(new SkyPosition(i * 17 % 219 - 100, 50 + i * 7 % 130, i * 43 % 211 - 100));
    var index = new SkyGoals(points);
    for (var i = 0; i < 400; i++) {
      var p = new SkyPosition(i * 13 % 333 - 150, i * 7 % 250, i * 19 % 377 - 180);
      var expected =
          points.stream()
              .mapToInt(
                  q -> Math.abs(p.x() - q.x()) + Math.abs(p.y() - q.y()) + Math.abs(p.z() - q.z()))
              .min()
              .orElseThrow();
      assertThat(index.distance(p)).isEqualTo(expected);
      assertThat(index.compatible(p))
          .isEqualTo(
              points.stream()
                  .noneMatch(
                      q ->
                          q.x() == p.x()
                              && q.z() == p.z()
                              && Math.abs(q.y() - p.y()) > 0
                              && Math.abs(q.y() - p.y()) < 4));
    }
  }
}

package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class PlotReviewsTest {

  private final UUID first = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private final UUID second = UUID.fromString("00000000-0000-0000-0000-000000000002");

  @Test
  void aSecondRatingFromTheSamePlayerReplacesTheScore() {
    var once = PlotReviews.rate(Map.of(), first, 3);
    var replaced = PlotReviews.rate(once, first, 5);

    assertThat(replaced).containsExactlyEntriesOf(Map.of(first, 5));

    var both = PlotReviews.rate(replaced, second, 4);
    assertThat(both).hasSize(2).containsEntry(second, 4);
    assertThat(PlotReviews.average(both)).isEqualTo("4.5");
    assertThat(PlotReviews.average(PlotReviews.rate(both, first, 4))).isEqualTo("4.0");
  }

  @Test
  void aScoreOutsideOneThroughFiveIsRefused() {
    assertThatThrownBy(() -> PlotReviews.rate(Map.of(), first, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> PlotReviews.rate(Map.of(), first, 6))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aCommentMustBeOneShortLine() {
    assertThat(PlotReviews.fits("  A dock  ", 140)).isTrue();
    assertThat(PlotReviews.fits("   ", 140)).isFalse();
    assertThat(PlotReviews.fits("a\nb", 140)).isFalse();
    assertThat(PlotReviews.fits("a".repeat(141), 140)).isFalse();
  }
}

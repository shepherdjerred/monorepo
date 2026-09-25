package com.shepherdjerred.thestorm.essentials.domain.back;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry.Cause;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

final class BackHistoryTest {

  static BackEntry entry(int x, Cause cause) {
    return new BackEntry(
        new Position("world", x, 64, 0, 0, 0), cause, Instant.EPOCH.plusSeconds(x));
  }

  @Test
  void capacityMustBePositive() {
    assertThatThrownBy(() -> BackHistory.of(0, List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void anEmptyHistoryHasNowhereToGo() {
    assertThat(BackHistory.of(3, List.of()).select(1)).isEqualTo(Result.err(new BackError.Empty()));
  }

  @Test
  void selectsTheMostRecentPlaceFirst() {
    var history =
        BackHistory.of(3, List.of()).push(entry(1, Cause.TELEPORT)).push(entry(2, Cause.DEATH));

    assertThat(history.select(1)).isEqualTo(Result.ok(entry(2, Cause.DEATH)));
    assertThat(history.select(2)).isEqualTo(Result.ok(entry(1, Cause.TELEPORT)));
  }

  @Test
  void refusesStepsOutsideTheHistory() {
    var history = BackHistory.of(3, List.of(entry(1, Cause.TELEPORT)));

    assertThat(history.select(2)).isEqualTo(Result.err(new BackError.NotThatFar(2, 1)));
    assertThat(history.select(0)).isEqualTo(Result.err(new BackError.NotThatFar(0, 1)));
  }

  @Test
  void keepsOnlyTheNewestEntries() {
    var history = BackHistory.of(2, List.of());
    for (var x = 1; x <= 5; x++) {
      history = history.push(entry(x, Cause.TELEPORT));
    }

    assertThat(history.entries())
        .containsExactly(entry(5, Cause.TELEPORT), entry(4, Cause.TELEPORT));
    assertThat(history.capacity()).isEqualTo(2);
  }

  @Test
  void aCapacityOfOneKeepsTheLatest() {
    var history =
        BackHistory.of(1, List.of()).push(entry(1, Cause.DEATH)).push(entry(2, Cause.TELEPORT));

    assertThat(history.entries()).containsExactly(entry(2, Cause.TELEPORT));
  }

  @Test
  void loadingMoreThanCapacityTruncates() {
    var history =
        BackHistory.of(
            2, List.of(entry(3, Cause.TELEPORT), entry(2, Cause.TELEPORT), entry(1, Cause.DEATH)));

    assertThat(history.entries())
        .containsExactly(entry(3, Cause.TELEPORT), entry(2, Cause.TELEPORT));
  }
}

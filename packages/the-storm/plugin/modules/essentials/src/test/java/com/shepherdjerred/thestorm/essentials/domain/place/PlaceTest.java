package com.shepherdjerred.thestorm.essentials.domain.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

final class PlaceTest {

  @ParameterizedTest
  @CsvSource({
    "home, home",
    "Base, base",
    "  My_Farm-2 , my_farm-2",
    "abcdefghijklmnop, abcdefghijklmnop"
  })
  void placeNamesAreNormalized(String input, String expected) {
    assertThat(PlaceName.parse(input)).isEqualTo(Result.ok(new PlaceName(expected)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "   ", "abcdefghijklmnopq", "my home", "café", "a.b", "../x"})
  void invalidPlaceNamesAreRejected(String input) {
    assertThat(PlaceName.parse(input).isOk()).isFalse();
  }

  @Test
  void placeNamesMustBeNormalizedWhenBuiltDirectly() {
    assertThatThrownBy(() -> new PlaceName("Home")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void placeNamesSortAndPrintAsTheirValue() {
    assertThat(new PlaceName("a")).isLessThan(new PlaceName("b")).hasToString("a");
  }

  @Test
  void positionsMustBeFiniteAndLevel() {
    assertThatThrownBy(() -> new Position(" ", 0, 0, 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Position("world", Double.NaN, 0, 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Position("world", 0, Double.POSITIVE_INFINITY, 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Position("world", 0, 0, 0, Float.NaN, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Position("world", 0, 0, 0, 0, 91))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void positionsDescribeTheirBlock() {
    assertThat(new Position("world", -0.5, 64.9, 12.1, 0, 0).describe())
        .isEqualTo("world -1, 64, 12");
  }

  @ParameterizedTest
  @CsvSource({
    "30s, PT30S",
    "15m, PT15M",
    "2h30m, PT2H30M",
    "7d, PT168H",
    "2w, PT336H",
    "1D12H, PT36H"
  })
  void parsesDurations(String input, Duration expected) {
    assertThat(DurationText.parse(input)).isEqualTo(Result.ok(expected));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "30", "m", "3x", "1.5h", "-1d", "0s", "1d 2h", "1234567s"})
  void rejectsBadDurations(String input) {
    assertThat(DurationText.parse(input).isOk()).isFalse();
  }

  @ParameterizedTest
  @CsvSource({
    "PT0S, 0s",
    "PT-1S, 0s",
    "PT0.001S, 1s",
    "PT59.5S, 1m",
    "PT1M, 1m",
    "PT1H1S, 1h 1s",
    "P1DT2H3M4S, 1d 2h 3m 4s"
  })
  void formatsDurations(Duration duration, String expected) {
    assertThat(DurationText.format(duration)).isEqualTo(expected);
  }
}

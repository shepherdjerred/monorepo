package com.shepherdjerred.thestorm.economy.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.app.Crystals;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class CrystalFormatTest {

  private static final CrystalFormat FORMAT =
      new CrystalFormat(new Currency("crystal", "crystals", "CR"));

  @CsvSource(
      delimiter = '|',
      value = {
        "0|0 crystals",
        "1000000|1,000,000 crystals",
        "1000|1,000 crystals",
        "1250|1,250 crystals",
        "1|1 crystal",
        "2|2 crystals",
        "9223372036854775807|9,223,372,036,854,775,807 crystals",
        "999|999 crystals"
      })
  @ParameterizedTest
  void wordsPluralizeAndGroupThousands(long amount, String expected) {
    assertThat(FORMAT.words(Crystals.of(amount))).isEqualTo(expected);
  }

  @CsvSource(
      delimiter = '|',
      value = {"0|0 CR", "12345678|12,345,678 CR", "1250|1,250 CR", "1|1 CR"})
  @ParameterizedTest
  void symbolNeverPluralizes(long amount, String expected) {
    assertThat(FORMAT.symbol(Crystals.of(amount))).isEqualTo(expected);
  }

  @Test
  void namesComeFromTheCurrency() {
    var shards = new CrystalFormat(new Currency("shard", "shards", "SH"));
    assertThat(shards.words(Crystals.of(1))).isEqualTo("1 shard");
    assertThat(shards.words(Crystals.of(3))).isEqualTo("3 shards");
    assertThat(shards.symbol(Crystals.of(3000))).isEqualTo("3,000 SH");
  }

  @Test
  void groupingIgnoresTheDefaultLocale() {
    var previous = Locale.getDefault();
    try {
      Locale.setDefault(Locale.GERMANY);
      assertThat(CrystalFormat.number(Crystals.of(1250))).isEqualTo("1,250");
    } finally {
      Locale.setDefault(previous);
    }
  }
}

package com.shepherdjerred.thestorm.economy.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Money;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class MoneyFormatTest {

  static final MoneyFormat FORMAT =
      new MoneyFormat(
          Map.of(
              CurrencyId.CRYSTALS,
              new Currency("crystal", "crystals", "CR"),
              CurrencyId.RWF_CREDITS,
              new Currency("Credit", "Credits", "RC")));

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
    assertThat(FORMAT.words(Money.crystals(amount))).isEqualTo(expected);
  }

  @CsvSource(
      delimiter = '|',
      value = {"0|0 CR", "12345678|12,345,678 CR", "1250|1,250 CR", "1|1 CR"})
  @ParameterizedTest
  void symbolNeverPluralizes(long amount, String expected) {
    assertThat(FORMAT.symbol(Money.crystals(amount))).isEqualTo(expected);
  }

  @Test
  void eachCurrencyUsesItsOwnNames() {
    assertThat(FORMAT.words(Money.rwfCredits(1))).isEqualTo("1 Credit");
    assertThat(FORMAT.words(Money.rwfCredits(3))).isEqualTo("3 Credits");
    assertThat(FORMAT.symbol(Money.rwfCredits(3000))).isEqualTo("3,000 RC");
    assertThat(FORMAT.currency(CurrencyId.RWF_CREDITS).plural()).isEqualTo("Credits");
  }

  @Test
  void everyCurrencyNeedsNames() {
    assertThatThrownBy(
            () ->
                new MoneyFormat(
                    Map.of(CurrencyId.CRYSTALS, new Currency("crystal", "crystals", "CR"))))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("rwf_credits");
  }

  @Test
  void groupingIgnoresTheDefaultLocale() {
    var previous = Locale.getDefault();
    try {
      Locale.setDefault(Locale.GERMANY);
      assertThat(MoneyFormat.number(Money.crystals(1250))).isEqualTo("1,250");
    } finally {
      Locale.setDefault(previous);
    }
  }
}

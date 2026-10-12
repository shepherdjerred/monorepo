package com.shepherdjerred.thestorm.economy.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.domain.Currency;
import com.shepherdjerred.thestorm.economy.domain.MoneyFormat;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ConfiguredMoneyFormatterTest {

  private static final MoneyFormatter FORMATTER =
      new ConfiguredMoneyFormatter(
          new MoneyFormat(
              Map.of(
                  CurrencyId.CRYSTALS,
                  new Currency("crystal", "crystals", "CR"),
                  CurrencyId.RWF_CREDITS,
                  new Currency("Credit", "Credits", "RC"))));

  @Test
  void wordsUseTheConfiguredSingularAndPlural() {
    assertThat(FORMATTER.words(Money.crystals(1))).isEqualTo("1 crystal");
    assertThat(FORMATTER.words(Money.crystals(0))).isEqualTo("0 crystals");
    assertThat(FORMATTER.words(Money.crystals(1250))).isEqualTo("1,250 crystals");
    assertThat(FORMATTER.words(Money.rwfCredits(1))).isEqualTo("1 Credit");
  }

  @Test
  void symbolUsesTheConfiguredSymbol() {
    assertThat(FORMATTER.symbol(Money.crystals(1250))).isEqualTo("1,250 CR");
    assertThat(FORMATTER.symbol(Money.crystals(1))).isEqualTo("1 CR");
    assertThat(FORMATTER.symbol(Money.rwfCredits(3))).isEqualTo("3 RC");
  }

  @Test
  void separatorsIgnoreTheDefaultLocale() {
    var previous = Locale.getDefault();
    try {
      Locale.setDefault(Locale.FRANCE);
      assertThat(FORMATTER.words(Money.crystals(1_000_000))).isEqualTo("1,000,000 crystals");
    } finally {
      Locale.setDefault(previous);
    }
  }
}

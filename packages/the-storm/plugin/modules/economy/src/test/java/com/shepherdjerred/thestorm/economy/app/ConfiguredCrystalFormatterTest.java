package com.shepherdjerred.thestorm.economy.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.domain.CrystalFormat;
import com.shepherdjerred.thestorm.economy.domain.Currency;
import java.util.Locale;
import org.junit.jupiter.api.Test;

final class ConfiguredCrystalFormatterTest {

  private static final CrystalFormatter FORMATTER =
      new ConfiguredCrystalFormatter(new CrystalFormat(new Currency("crystal", "crystals", "CR")));

  @Test
  void wordsUseTheConfiguredSingularAndPlural() {
    assertThat(FORMATTER.words(Crystals.of(1))).isEqualTo("1 crystal");
    assertThat(FORMATTER.words(Crystals.ZERO)).isEqualTo("0 crystals");
    assertThat(FORMATTER.words(Crystals.of(1250))).isEqualTo("1,250 crystals");
  }

  @Test
  void symbolUsesTheConfiguredSymbol() {
    assertThat(FORMATTER.symbol(Crystals.of(1250))).isEqualTo("1,250 CR");
    assertThat(FORMATTER.symbol(Crystals.of(1))).isEqualTo("1 CR");
  }

  @Test
  void namesFollowTheConfig() {
    var shards =
        new ConfiguredCrystalFormatter(new CrystalFormat(new Currency("shard", "shards", "SH")));
    assertThat(shards.words(Crystals.of(2000))).isEqualTo("2,000 shards");
    assertThat(shards.symbol(Crystals.of(2000))).isEqualTo("2,000 SH");
  }

  @Test
  void separatorsIgnoreTheDefaultLocale() {
    var previous = Locale.getDefault();
    try {
      Locale.setDefault(Locale.FRANCE);
      assertThat(FORMATTER.words(Crystals.of(1_000_000))).isEqualTo("1,000,000 crystals");
    } finally {
      Locale.setDefault(previous);
    }
  }
}

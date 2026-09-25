package com.shepherdjerred.thestorm.economy.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class EconomyConfigTest {

  /** The file the server actually ships, relative to this module's project directory. */
  private static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/economy.yml");

  private static final String VALID =
      """
      currency:
        singular: crystal
        plural: crystals
        symbol: CR
      startingBalance: 500
      baltopSize: 10
      """;

  @Test
  void theShippedFileParses() {
    var config = ConfigFiles.load(SHIPPED, EconomyConfig.class);
    assertThat(config)
        .isEqualTo(new EconomyConfig(new Currency("crystal", "crystals", "CR"), 500, 10));
    assertThat(config.startingCrystals()).isEqualTo(Crystals.of(500));
  }

  @Test
  void aValidDocumentParses() {
    assertThat(StrictYaml.parse("economy.yml", VALID, EconomyConfig.class).isOk()).isTrue();
  }

  @Test
  void unknownKeysAreRejected() {
    var yaml = VALID + "interestRate: 5\n";
    assertThat(StrictYaml.parse("economy.yml", yaml, EconomyConfig.class).isOk()).isFalse();
  }

  @Test
  void missingKeysAreRejected() {
    var yaml = VALID.replace("baltopSize: 10\n", "");
    assertThat(StrictYaml.parse("economy.yml", yaml, EconomyConfig.class).isOk()).isFalse();
  }

  @Test
  void missingCurrencyNamesAreRejected() {
    var yaml = VALID.replace("  symbol: CR\n", "");
    assertThat(StrictYaml.parse("economy.yml", yaml, EconomyConfig.class).isOk()).isFalse();
  }

  @Test
  void aNegativeStartingBalanceIsRejected() {
    var yaml = VALID.replace("startingBalance: 500", "startingBalance: -1");
    assertThat(StrictYaml.parse("economy.yml", yaml, EconomyConfig.class).isOk()).isFalse();
  }

  @Test
  void aZeroStartingBalanceIsAllowed() {
    var currency = new Currency("crystal", "crystals", "CR");
    assertThat(new EconomyConfig(currency, 0, 10).startingCrystals()).isEqualTo(Crystals.ZERO);
  }

  @Test
  void baltopSizeIsBounded() {
    var currency = new Currency("crystal", "crystals", "CR");
    assertThatThrownBy(() -> new EconomyConfig(currency, 500, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new EconomyConfig(currency, 500, EconomyConfig.MAX_BALTOP_SIZE + 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(new EconomyConfig(currency, 500, EconomyConfig.MAX_BALTOP_SIZE).baltopSize())
        .isEqualTo(EconomyConfig.MAX_BALTOP_SIZE);
  }

  @Test
  void currencyNamesMustBeTrimmedAndNonBlank() {
    assertThatThrownBy(() -> new Currency("", "crystals", "CR"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Currency("crystal", "  ", "CR"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Currency("crystal", "crystals", " CR"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}

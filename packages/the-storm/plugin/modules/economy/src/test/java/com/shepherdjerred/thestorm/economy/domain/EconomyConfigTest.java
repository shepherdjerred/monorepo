package com.shepherdjerred.thestorm.economy.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Money;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class EconomyConfigTest {

  /** The file the server actually ships, relative to this module's project directory. */
  private static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/economy.yml");

  private static final Currency CRYSTAL = new Currency("crystal", "crystals", "CR");
  private static final Currency CREDIT = new Currency("Credit", "Credits", "RC");
  private static final Map<String, Currency> BOTH =
      Map.of("crystals", CRYSTAL, "rwf_credits", CREDIT);

  private static final String VALID =
      """
      currencies:
        crystals:
          singular: crystal
          plural: crystals
          symbol: CR
        rwf_credits:
          singular: Credit
          plural: Credits
          symbol: RC
      startingBalance: 500
      baltopSize: 10
      """;

  @Test
  void theShippedFileParses() {
    var config = ConfigFiles.load(SHIPPED, EconomyConfig.class);
    assertThat(config).isEqualTo(new EconomyConfig(BOTH, 500, 10));
    assertThat(config.startingCrystals()).isEqualTo(Money.crystals(500));
    assertThat(config.format().currency(CurrencyId.RWF_CREDITS)).isEqualTo(CREDIT);
    assertThat(config.format().symbol(Money.rwfCredits(3))).isEqualTo("3 RC");
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
    var yaml = VALID.replace("    symbol: CR\n", "");
    assertThat(StrictYaml.parse("economy.yml", yaml, EconomyConfig.class).isOk()).isFalse();
  }

  @Test
  void everyCurrencyMustBeListedAndNoOther() {
    assertThatThrownBy(() -> new EconomyConfig(Map.of("crystals", CRYSTAL), 500, 10))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("rwf_credits");
    assertThatThrownBy(
            () ->
                new EconomyConfig(
                    Map.of("crystals", CRYSTAL, "rwf_credits", CREDIT, "shards", CRYSTAL), 500, 10))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("shards");
  }

  @Test
  void aNegativeStartingBalanceIsRejected() {
    var yaml = VALID.replace("startingBalance: 500", "startingBalance: -1");
    assertThat(StrictYaml.parse("economy.yml", yaml, EconomyConfig.class).isOk()).isFalse();
  }

  @Test
  void aZeroStartingBalanceIsAllowed() {
    assertThat(new EconomyConfig(BOTH, 0, 10).startingCrystals()).isEqualTo(Money.crystals(0));
  }

  @Test
  void baltopSizeIsBounded() {
    assertThatThrownBy(() -> new EconomyConfig(BOTH, 500, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new EconomyConfig(BOTH, 500, EconomyConfig.MAX_BALTOP_SIZE + 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(new EconomyConfig(BOTH, 500, EconomyConfig.MAX_BALTOP_SIZE).baltopSize())
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

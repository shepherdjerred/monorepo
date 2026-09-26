package com.shepherdjerred.thestorm.shops.domain.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class CatalogValidationTest {

  private static final Set<String> ITEMS = Set.of("coal", "iron_ingot", "emerald", "bread");

  private static CatalogEntry entry(
      String item, int quantity, @Nullable Long buy, @Nullable Long sell) {
    return new CatalogEntry(
        item, quantity, Optional.ofNullable(buy), Optional.ofNullable(sell), OptionalInt.empty());
  }

  private static CatalogFile file(String id, CatalogEntry... entries) {
    return new CatalogFile(id + ".yml", new Catalog(id, "Name", "Hello.", List.of(entries)));
  }

  private static List<CatalogProblem> problems(CatalogFile... files) {
    return CatalogValidator.standard(ITEMS::contains)
        .validate(List.of(files))
        .fold(catalogs -> List.of(), errors -> errors);
  }

  @Test
  void parsesAnEntryWithExplicitNulls() {
    var yaml =
        """
        id: baker
        name: Bobert's Bakery
        greeting: Fresh bread!
        entries:
          - item: bread
            quantity: 8
            buy: 24
            sell: null
            dailyLimit: null
          - item: minecraft:wheat
            quantity: 16
            buy: null
            sell: 12
            dailyLimit: 640
        """;

    var catalog = StrictYaml.parse("baker.yml", yaml, Catalog.class).fold(c -> c, this::fail);

    assertThat(catalog.entries().get(0).prices()).isEqualTo(ShopPrices.buyOnly(24));
    assertThat(catalog.entries().get(1).prices()).isEqualTo(ShopPrices.sellOnly(12));
    assertThat(catalog.entries().get(1).itemKey()).isEqualTo("wheat");
    assertThat(catalog.entries().get(1).dailyLimit()).hasValue(640);
    assertThat(catalog.entry("minecraft:bread")).contains(catalog.entries().get(0));
    assertThat(catalog.entry("cake")).isEmpty();
  }

  private Catalog fail(List<Problem> problems) {
    throw new AssertionError(problems.toString());
  }

  @Test
  void aMissingSideIsAnErrorNotADefault() {
    var yaml =
        """
        id: baker
        name: Bakery
        greeting: Hi
        entries:
          - item: bread
            quantity: 8
            buy: 24
            dailyLimit: null
        """;

    assertThat(StrictYaml.parse("baker.yml", yaml, Catalog.class).isOk()).isFalse();
  }

  @Test
  void entryInvariantsAreReportedAtTheirPath() {
    var yaml =
        """
        id: baker
        name: Bakery
        greeting: Hi
        entries:
          - item: bread
            quantity: 8
            buy: 10
            sell: 20
            dailyLimit: null
        """;

    var problems =
        StrictYaml.parse("baker.yml", yaml, Catalog.class).fold(c -> List.<Problem>of(), p -> p);

    assertThat(problems)
        .singleElement()
        .satisfies(
            problem -> {
              assertThat(problem.path()).isEqualTo("entries[0]");
              assertThat(problem.message()).contains("must not be above");
            });
  }

  @ParameterizedTest
  @ValueSource(strings = {"Coal", "coal block", "minecraft:", "", "iron-ingot", "other:coal"})
  void itemKeysAreLowercaseKeys(String item) {
    assertThatThrownBy(() -> entry(item, 1, 1L, null)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void entryInvariants() {
    assertThatThrownBy(() -> entry("coal", 0, 1L, null)).hasMessageContaining("quantity");
    assertThatThrownBy(() -> entry("coal", CatalogEntry.MAX_QUANTITY + 1, 1L, null))
        .hasMessageContaining("quantity");
    assertThatThrownBy(() -> entry("coal", 1, 0L, null)).hasMessageContaining("prices");
    assertThatThrownBy(() -> entry("coal", 1, null, -1L)).hasMessageContaining("prices");
    assertThatThrownBy(() -> entry("coal", 1, null, null)).hasMessageContaining("buy price");
    assertThatThrownBy(() -> entry("coal", 1, 4L, 5L)).hasMessageContaining("must not be above");
    assertThatThrownBy(
            () ->
                new CatalogEntry("coal", 16, Optional.of(1L), Optional.empty(), OptionalInt.of(15)))
        .hasMessageContaining("at least one trade");
  }

  @Test
  void catalogInvariants() {
    var entries = List.of(entry("coal", 1, 1L, null));
    assertThatThrownBy(() -> new Catalog("Bad Id", "Name", "Hi", entries))
        .hasMessageContaining("id");
    assertThatThrownBy(() -> new Catalog("-bad", "Name", "Hi", entries)).hasMessageContaining("id");
    assertThatThrownBy(() -> new Catalog("ok", " ", "Hi", entries)).hasMessageContaining("name");
    assertThatThrownBy(() -> new Catalog("ok", "Name", "", entries))
        .hasMessageContaining("greeting");
    assertThatThrownBy(() -> new Catalog("ok", "Name", "Hi", List.of()))
        .hasMessageContaining("at least one entry");
  }

  @Test
  void validCatalogsPass() {
    var result =
        CatalogValidator.standard(ITEMS::contains)
            .validate(
                List.of(
                    file("blacksmith", entry("iron_ingot", 8, 96L, 32L)),
                    file("reynolds", entry("coal", 16, 48L, 16L), entry("bread", 1, 3L, null))));

    assertThat(result.<Integer>fold(List::size, errors -> -1)).isEqualTo(2);
  }

  @Test
  void fileNamesMatchIds() {
    var misnamed =
        new CatalogFile(
            "baker.yml", new Catalog("bakery", "Name", "Hi", List.of(entry("bread", 1, 1L, null))));

    assertThat(problems(misnamed))
        .containsExactly(new CatalogProblem.FileNameMismatch("baker.yml", "bakery"));
  }

  @Test
  void idsAreUnique() {
    var first = file("baker", entry("bread", 1, 1L, null));
    var second =
        new CatalogFile(
            "copy.yml", new Catalog("baker", "Name", "Hi", List.of(entry("bread", 1, 1L, null))));

    assertThat(problems(first, second))
        .contains(new CatalogProblem.DuplicateId("baker"))
        .doesNotHaveDuplicates();
  }

  @Test
  void aCatalogListsEachItemOnce() {
    var twice =
        file(
            "baker",
            entry("bread", 1, 1L, null),
            entry("minecraft:bread", 2, 2L, null),
            entry("bread", 3, 3L, null));

    assertThat(problems(twice)).containsExactly(new CatalogProblem.DuplicateItem("baker", "bread"));
  }

  @Test
  void everyItemExists() {
    assertThat(problems(file("baker", entry("cake", 1, 1L, null), entry("bread", 1, 1L, null))))
        .containsExactly(new CatalogProblem.UnknownItem("baker", "cake"));
  }

  @Test
  void noCatalogPaysMorePerItemThanAnotherCharges() {
    // The blacksmith charges 12 per ingot; the exchange would pay 13.
    var blacksmith = file("blacksmith", entry("iron_ingot", 8, 96L, 32L));
    var exchange = file("exchange", entry("iron_ingot", 1, null, 13L));

    assertThat(problems(blacksmith, exchange))
        .containsExactly(new CatalogProblem.Arbitrage("iron_ingot", "exchange", "blacksmith"));
  }

  @Test
  void equalPerItemPricesAcrossTradeSizesAreAllowed() {
    var blacksmith = file("blacksmith", entry("iron_ingot", 8, 96L, null));
    var exchange = file("exchange", entry("iron_ingot", 1, null, 12L));

    assertThat(problems(blacksmith, exchange)).isEmpty();
  }

  @Test
  void differentItemsNeverConflict() {
    var a = file("a", entry("coal", 1, 1L, null));
    var b = file("b", entry("emerald", 1, null, 100L));

    assertThat(problems(a, b)).isEmpty();
  }

  @Test
  void problemsDescribeThemselves() {
    assertThat(new CatalogProblem.Arbitrage("coal", "a", "b").describe())
        .isEqualTo(
            "a pays more per coal than b charges; buying there and selling here would print"
                + " crystals");
    assertThat(
            List.<CatalogProblem>of(
                new CatalogProblem.DuplicateId("x"),
                new CatalogProblem.FileNameMismatch("x.yml", "y"),
                new CatalogProblem.DuplicateItem("x", "coal"),
                new CatalogProblem.UnknownItem("x", "blorp")))
        .allSatisfy(problem -> assertThat(problem.describe()).isNotBlank());
  }

  @Test
  void dailyAllowancesCountDown() {
    var allowance = new DailyAllowance(64, 48);

    assertThat(allowance.remaining()).isEqualTo(16);
    assertThat(allowance.permits(16)).isTrue();
    assertThat(allowance.permits(17)).isFalse();
    assertThat(allowance.lotsLeft(8)).isEqualTo(2);
    assertThat(new DailyAllowance(64, 100).remaining()).isZero();
    assertThatThrownBy(() -> new DailyAllowance(0, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> allowance.lotsLeft(0)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theDayStartsAtLocalMidnight() {
    var now = Instant.parse("2026-09-25T05:30:00Z");

    assertThat(DailyAllowance.dayStart(now, ZoneId.of("UTC")))
        .isEqualTo(Instant.parse("2026-09-25T00:00:00Z"));
    assertThat(DailyAllowance.dayStart(now, ZoneId.of("America/Los_Angeles")))
        .isEqualTo(Instant.parse("2026-09-24T07:00:00Z"));
  }

  @Test
  void validatorsCompose() {
    CatalogRule always = files -> List.of(new CatalogProblem.DuplicateId("x"));
    var validator = new CatalogValidator(List.of(always));

    assertThat(validator.validate(List.of()))
        .isEqualTo(Result.err(List.of(new CatalogProblem.DuplicateId("x"))));
  }
}

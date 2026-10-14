package com.shepherdjerred.thestorm.rwf.domain.kit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Comparator;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class KitBrowserTest {
  @Test
  void defaultOrderRetainsTheCatalogAndNameOrderIsDeterministic() {
    assertThat(KitBrowser.Query.DEFAULT.select(KitBook.ALL, KitAccess.EVERYTHING))
        .isEqualTo(KitBook.ALL);
    var byName =
        new KitBrowser.Query(0, KitBrowser.Sort.NAME, Optional.empty(), KitBrowser.Access.ALL);
    assertThat(byName.select(KitBook.ALL, KitAccess.EVERYTHING))
        .isSortedAccordingTo(
            Comparator.comparing(KitSpec::name, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(KitSpec::id));
    var byPrice =
        new KitBrowser.Query(0, KitBrowser.Sort.PRICE, Optional.empty(), KitBrowser.Access.ALL);
    assertThat(byPrice.select(KitBook.ALL, KitAccess.EVERYTHING))
        .isSortedAccordingTo(Comparator.comparingInt(KitSpec::price));
    var byTier =
        new KitBrowser.Query(0, KitBrowser.Sort.TIER, Optional.empty(), KitBrowser.Access.ALL);
    assertThat(byTier.select(KitBook.ALL, KitAccess.EVERYTHING))
        .isSortedAccordingTo(Comparator.comparing(KitSpec::tier));
  }

  @Test
  void categoryAndAccessFiltersComposeWithoutShowingLockedKitsAsAvailable() {
    var available =
        new KitBrowser.Query(
            0, KitBrowser.Sort.NAME, Optional.of(KitCategory.RANGED), KitBrowser.Access.AVAILABLE);
    var access = KitAccess.of(Set.of(KitBook.LONGBOW.id()), Set.of());
    assertThat(available.select(KitBook.ALL, access))
        .isNotEmpty()
        .allMatch(kit -> kit.category() == KitCategory.RANGED && access.allows(kit));
    var rotating =
        new KitBrowser.Query(
            0, KitBrowser.Sort.ORIGINAL, Optional.empty(), KitBrowser.Access.ROTATION);
    assertThat(rotating.select(KitBook.ALL, access)).isEmpty();
    var weekly = KitAccess.of(Set.of(), Set.of(KitBook.LONGBOW.id()));
    assertThat(rotating.select(KitBook.ALL, weekly)).containsExactly(KitBook.LONGBOW);
  }

  @Test
  void ownedDoesNotMistakeBorrowedWeeklyKitsForPurchases() {
    var owned =
        new KitBrowser.Query(
            0, KitBrowser.Sort.ORIGINAL, Optional.empty(), KitBrowser.Access.OWNED);
    var purchasable = KitBook.ALL.stream().filter(KitSpec::purchasable).findFirst().orElseThrow();
    var weekly = KitAccess.of(Set.of(), Set.of(purchasable.id()));
    assertThat(owned.select(KitBook.ALL, weekly))
        .doesNotContain(purchasable)
        .allMatch(kit -> kit.availability() == KitAvailability.FREE);
  }

  @Test
  void changingControlsResetsPageWhilePageNavigationPreservesFilters() {
    var query =
        new KitBrowser.Query(
            3, KitBrowser.Sort.PRICE, Optional.of(KitCategory.RANGED), KitBrowser.Access.AVAILABLE);
    assertThat(query.at(2).category()).contains(KitCategory.RANGED);
    assertThat(query.at(2).sort()).isEqualTo(KitBrowser.Sort.PRICE);
    assertThat(query.at(2).access()).isEqualTo(KitBrowser.Access.AVAILABLE);
    assertThat(query.nextCategory().page()).isZero();
    assertThat(query.nextAccess().page()).isZero();
    assertThat(query.nextSort().page()).isZero();
    assertThat(
            KitBrowser.Query.DEFAULT
                .nextCategory()
                .nextCategory()
                .nextCategory()
                .nextCategory()
                .category())
        .isEmpty();
  }
}

package com.shepherdjerred.thestorm.rwf.domain.kit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The kit catalogue's economy: prices and tiers, the free kits, the weekly rotation, who may pick
 * what, and saved layouts.
 */
final class KitEconomyTest {

  @Nested
  final class Catalogue {

    @Test
    void thereAreRedWarfaresTwentyFiveKitsAndTheStormsEightInMenuOrder() {
      assertThat(KitBook.ALL).hasSize(33);
      assertThat(KitBook.ALL.stream().map(KitSpec::id).distinct()).hasSize(33);
      assertThat(KitBook.ALL.subList(0, 22))
          .extracting(KitSpec::id)
          .as("SearchAndDestroy's own kit order")
          .containsExactly(
              "trooper",
              "berserker",
              "demolitions",
              "dwarf",
              "explosive",
              "ghost",
              "juggernaut",
              "longbow",
              "medic",
              "pyro",
              "rewind",
              "shortbow",
              "spy",
              "teleporter",
              "vampire",
              "venom",
              "warper",
              "ninja",
              "frost",
              "skinner",
              "wraith",
              "bleeder");
      assertThat(KitBook.ALL.subList(22, 33))
          .extracting(KitSpec::id)
          .containsExactly(
              "equality",
              "inertia",
              "sacrificial",
              "sapper",
              "saboteur",
              "spotter",
              "grappler",
              "bannerman",
              "engineer",
              "tracker",
              "decoy");
    }

    @Test
    void theOriginalFreeKitsStayFreeAndEveryOtherKitIsBought() {
      var free = KitBook.ALL.stream().filter(kit -> !kit.purchasable()).map(KitSpec::id).toList();

      assertThat(free)
          .containsExactlyInAnyOrder(
              "trooper", "longbow", "shortbow", "rewind", "medic", "teleporter");
      for (var kit : KitBook.ALL) {
        assertThat(kit.availability())
            .isEqualTo(kit.purchasable() ? KitAvailability.PURCHASE : KitAvailability.FREE);
      }
    }

    @Test
    void pricesAreRedWarfaresOwnAndTheNewKitsFollowThePlan() {
      Map<String, Integer> prices =
          KitBook.ALL.stream().collect(Collectors.toUnmodifiableMap(KitSpec::id, KitSpec::price));

      assertThat(prices)
          .containsEntry("berserker", 400)
          .containsEntry("bleeder", 400)
          .containsEntry("demolitions", 300)
          .containsEntry("dwarf", 500)
          .containsEntry("equality", 350)
          .containsEntry("explosive", 150)
          .containsEntry("frost", 150)
          .containsEntry("ghost", 150)
          .containsEntry("juggernaut", 350)
          .containsEntry("ninja", 200)
          .containsEntry("pyro", 200)
          .containsEntry("sacrificial", 500)
          .containsEntry("skinner", 300)
          .containsEntry("spy", 250)
          .containsEntry("vampire", 300)
          .containsEntry("venom", 400)
          .containsEntry("warper", 250)
          .containsEntry("wraith", 200)
          .containsEntry("sapper", 150)
          .containsEntry("saboteur", 200)
          .containsEntry("spotter", 250)
          .containsEntry("grappler", 300)
          .containsEntry("bannerman", 300)
          .containsEntry("engineer", 400)
          .containsEntry("tracker", 400)
          .containsEntry("decoy", 450);
      assertThat(prices.values()).allMatch(price -> price == 0 || (price >= 150 && price <= 500));
    }

    @Test
    void aBoughtKitsTierFollowsItsPrice() {
      for (var kit : KitBook.ALL) {
        if (!kit.purchasable()) {
          continue;
        }
        var expected =
            kit.price() <= 200
                ? KitTier.BASIC
                : kit.price() <= 350 ? KitTier.MID : KitTier.ADVANCED;
        assertThat(kit.tier()).as(kit.id()).isEqualTo(expected);
      }
      assertThat(KitBook.SAPPER.tier()).isEqualTo(KitTier.BASIC);
      assertThat(KitBook.SPOTTER.tier()).isEqualTo(KitTier.MID);
      assertThat(KitBook.DECOY.tier()).isEqualTo(KitTier.ADVANCED);
    }

    @Test
    void everyKitWithAnAbilityNamesIt() {
      var plain = Set.of("trooper", "longbow", "shortbow", "pyro");
      for (var kit : KitBook.ALL) {
        assertThat(kit.ability().isEmpty()).as(kit.id()).isEqualTo(plain.contains(kit.id()));
      }
    }

    @Test
    void theFuseIsTitledAndLabelledAsRedWarfaresWas() {
      assertThat(KitSpec.FUSE.name()).contains("Bomb Fuse");
      assertThat(KitSpec.FUSE.look().nameColor()).contains("gold");
      assertThat(KitSpec.FUSE.look().loreColor()).contains("light_purple");
      assertThat(KitSpec.FUSE.look().lore())
          .containsExactly("§lRIGHT CLICK BOMB TO ARM AND DISARM");
      assertThat(KitBook.REWIND.hotbar().get(1).look().nameColor()).contains("gold");
      assertThat(KitBook.VENOM.hotbar().getFirst().look().glint()).isTrue();
      assertThat(KitBook.SHORTBOW.menu().icon()).isEqualTo("BOW");
    }
  }

  @Nested
  final class Layouts {

    @Test
    void aKitsArrowGoesToInventorySlotNineAndItsGapsStayEmpty() {
      assertThat(KitBook.LONGBOW.layout())
          .extracting(KitSpec.Placement::slot)
          .containsExactly(0, 1, 2, KitSpec.ARROW_SLOT);
      assertThat(KitBook.GHOST.layout())
          .extracting(KitSpec.Placement::slot)
          .as("the ghost's second slot stays free")
          .containsExactly(0, 1, 3);
      assertThat(KitBook.TROOPER.layout())
          .extracting(KitSpec.Placement::slot)
          .containsExactly(0, 1, 2);
    }

    @Test
    void aSavedLayoutPlacesTheKitWhereThePlayerKeepsIt() {
      var saved = new KitLayout(Map.of(0, 0, 1, 5, 2, 3, 3, 20));

      var placed = KitLayout.place(KitBook.LONGBOW, Optional.of(saved));

      assertThat(placed).extracting(KitSpec.Placement::slot).containsExactly(0, 5, 3, 20);
      assertThat(placed.get(1).item().material()).isEqualTo("STONE_SWORD");
    }

    @Test
    void aLayoutThatNoLongerFitsTheKitFallsBackToTheKitsOwn() {
      var stale = new KitLayout(Map.of(0, 0, 1, 5));
      var movedFuse = new KitLayout(Map.of(0, 4, 1, 5, 2, 3, 3, 20));

      assertThat(KitLayout.place(KitBook.LONGBOW, Optional.of(stale)))
          .isEqualTo(KitLayout.place(KitBook.LONGBOW, Optional.empty()));
      assertThat(movedFuse.fits(KitBook.LONGBOW)).as("the fuse is locked in slot 0").isFalse();
    }

    @Test
    void aLayoutRefusesTwoItemsInOneSlot() {
      assertThatThrownBy(() -> new KitLayout(Map.of(0, 0, 1, 0)))
          .hasMessageContaining("share a slot");
      assertThatThrownBy(() -> new KitLayout(Map.of(0, 36))).hasMessageContaining("0-35");
    }
  }

  @Nested
  final class Rotation {

    private static final List<KitSpec> KITS = KitBook.ALL;

    @Test
    void eachWeekOffersFourBoughtKitsWithOneOrTwoBasic() {
      var week = new KitRotation.Week(KitRotation.EPOCH);
      for (var i = 0; i < 200; i++) {
        var free = KitRotation.of(week, KITS);
        assertThat(free).hasSize(KitRotation.SIZE).allMatch(KitSpec::purchasable);
        var basic = free.stream().filter(kit -> kit.tier() == KitTier.BASIC).count();
        assertThat(basic).as("week of %s", week.monday()).isBetween(1L, 2L);
        week = week.next();
      }
    }

    @Test
    void noKitIsFreeTwoWeeksRunning() {
      var week = new KitRotation.Week(KitRotation.EPOCH);
      var previous = Set.<KitSpec>of();
      for (var i = 0; i < 200; i++) {
        var free = Set.copyOf(KitRotation.of(week, KITS));
        if (!previous.isEmpty()) {
          assertThat(free).as("week of %s", week.monday()).doesNotContainAnyElementsOf(previous);
        }
        previous = free;
        week = week.next();
      }
    }

    @Test
    void theRotationIsAPureFunctionOfTheWeekAndShiftsWeekly() {
      var week = KitRotation.Week.of(Instant.parse("2026-10-14T18:00:00Z"));

      assertThat(week.monday()).isEqualTo(LocalDate.of(2026, 10, 12));
      assertThat(KitRotation.Week.of(Instant.parse("2026-10-12T00:00:00Z"))).isEqualTo(week);
      assertThat(KitRotation.Week.of(Instant.parse("2026-10-11T23:59:59Z")))
          .isEqualTo(week.previous());
      assertThat(week.endsAt()).isEqualTo(Instant.parse("2026-10-19T00:00:00Z"));
      assertThat(KitRotation.of(week, KITS)).isEqualTo(KitRotation.of(week, KITS));
      var seen = new HashSet<List<KitSpec>>();
      for (var i = 0; i < 10; i++) {
        seen.add(KitRotation.of(week, KITS));
        week = week.next();
      }
      assertThat(seen).hasSizeGreaterThan(5);
    }

    @Test
    void theRotationIsListedInMenuOrder() {
      var free = KitRotation.of(new KitRotation.Week(KitRotation.EPOCH.plusWeeks(9)), KITS);

      assertThat(free).isSortedAccordingTo((a, b) -> KITS.indexOf(a) - KITS.indexOf(b));
    }

    @Test
    void tooFewKitsToRotateFailLoudly() {
      assertThatThrownBy(
              () ->
                  KitRotation.of(
                      new KitRotation.Week(KitRotation.EPOCH), List.of(KitBook.NINJA, KitBook.SPY)))
          .isInstanceOf(IllegalStateException.class);
      assertThatThrownBy(() -> new KitRotation.Week(LocalDate.of(2026, 10, 13)))
          .hasMessageContaining("Monday");
    }
  }

  @Nested
  final class Access {

    @Test
    void freeKitsAreOpenToEveryoneAndBoughtKitsToTheirOwners() {
      var access = KitAccess.of(Set.of("ninja"), Set.of("spy"));

      assertThat(access.allows(KitBook.MEDIC)).isTrue();
      assertThat(access.allows(KitBook.NINJA)).isTrue();
      assertThat(access.allows(KitBook.SPY)).isTrue();
      assertThat(access.borrowed(KitBook.SPY)).isTrue();
      assertThat(access.borrowed(KitBook.NINJA)).isFalse();
      assertThat(access.lock(KitBook.DWARF)).contains(KitAccess.Lock.NOT_OWNED);
    }

    @Test
    void withTheKitListOffOnlyTheFirstFourAreOpen() {
      for (var kit : KitBook.ALL) {
        assertThat(KitAccess.MILESTONE_ONE.allows(kit))
            .as(kit.id())
            .isEqualTo(KitBook.MILESTONE_ONE.contains(kit));
      }
      assertThat(KitAccess.MILESTONE_ONE.lock(KitBook.MEDIC)).contains(KitAccess.Lock.UNAVAILABLE);
    }

    @Test
    void botsMayPickAnything() {
      assertThat(KitBook.ALL).allMatch(KitAccess.EVERYTHING::allows);
      assertThat(KitAccess.EVERYTHING.borrowed(KitBook.DWARF)).isFalse();
    }
  }
}

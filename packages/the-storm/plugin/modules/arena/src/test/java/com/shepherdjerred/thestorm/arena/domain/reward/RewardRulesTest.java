package com.shepherdjerred.thestorm.arena.domain.reward;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.FLAT;
import static com.shepherdjerred.thestorm.arena.testing.Samples.item;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.arena.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.arena.domain.kit.Slot;
import com.shepherdjerred.thestorm.arena.domain.wave.Tier;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveKind;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;

final class RewardRulesTest {

  private static final RewardSettings REWARDS =
      new RewardSettings(30, 125, 750, new VaultSettings("UTC", List.of()));

  @Test
  void onlyBossWavesFromTheFirstRewardWavePay() {
    assertThat(REWARDS.waveReward(20, WaveKind.BOSS, FLAT)).isZero();
    assertThat(REWARDS.waveReward(30, WaveKind.BOSS, FLAT)).isEqualTo(125);
    assertThat(REWARDS.waveReward(35, WaveKind.SWARM, FLAT)).isZero();
    assertThat(REWARDS.waveReward(31, WaveKind.UPGRADE, FLAT)).isZero();
  }

  @Test
  void higherTiersPayMore() {
    var fifth = new Tier("Ominous V", 1.75, 1.5, 1.4, 2.0);
    var third = new Tier("Ominous III", 1.3, 1.2, 1.2, 1.4);

    assertThat(REWARDS.waveReward(40, WaveKind.BOSS, fifth)).isEqualTo(250);
    assertThat(REWARDS.waveReward(40, WaveKind.BOSS, third)).isEqualTo(175);
  }

  @Test
  void theCapScalesWithTheTiersRewardMultiplier() {
    assertThat(REWARDS.capPerGame(FLAT)).isEqualTo(750);
    assertThat(REWARDS.capPerGame(new Tier("Ominous III", 1.3, 1.2, 1.2, 1.4))).isEqualTo(1050);
    assertThat(REWARDS.capPerGame(new Tier("Ominous V", 1.75, 1.5, 1.4, 2.0))).isEqualTo(1500);
  }

  @Test
  void settingsAreChecked() {
    var vault = new VaultSettings("UTC", List.of());
    assertThatThrownBy(() -> new RewardSettings(0, 1, 1, vault)).hasMessageContaining("firstWave");
    assertThatThrownBy(() -> new RewardSettings(1, -1, 1, vault)).hasMessageContaining("negative");
    assertThatThrownBy(() -> new RewardSettings(1, 800, 750, vault))
        .hasMessageContaining("baseCapPerGame");
  }

  @Test
  void theLedgerCapsEachPlayersGame() {
    var ledger = RewardLedger.EMPTY;
    var paid = new HashMap<Integer, Long>();
    for (var wave = 30; wave <= 72; wave += 10) {
      var grant = ledger.grant(ALICE, 250, 750);
      ledger = grant.ledger();
      paid.put(wave, grant.amount());
    }

    assertThat(paid).containsEntry(30, 250L).containsEntry(40, 250L).containsEntry(50, 250L);
    assertThat(paid).containsEntry(60, 0L).containsEntry(70, 0L);
    assertThat(ledger.paidTo(ALICE)).isEqualTo(750);
    assertThat(ledger.paidTo(BOB)).isZero();
  }

  @Test
  void theLastGrantIsTrimmedToTheCap() {
    var ledger = RewardLedger.EMPTY.grant(ALICE, 700, 750).ledger();

    var grant = ledger.grant(ALICE, 125, 750);

    assertThat(grant.amount()).isEqualTo(50);
    assertThat(grant.ledger().paidTo(ALICE)).isEqualTo(750);
  }

  @Test
  void aZeroGrantLeavesTheLedgerAlone() {
    var grant = RewardLedger.EMPTY.grant(ALICE, 0, 750);

    assertThat(grant.amount()).isZero();
    assertThat(grant.ledger()).isSameAs(RewardLedger.EMPTY);
    assertThatThrownBy(() -> RewardLedger.EMPTY.grant(ALICE, -1, 750))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aFullSoloClearOfTheShippedScheduleEarnsExactlyTheCap() {
    var ledger = RewardLedger.EMPTY;
    var total = 0L;
    for (var wave : List.of(10, 20, 30, 40, 50, 60, 70, 72)) {
      var grant = ledger.grant(ALICE, REWARDS.waveReward(wave, WaveKind.BOSS, FLAT), 750);
      ledger = grant.ledger();
      total += grant.amount();
    }

    assertThat(total).isEqualTo(750);
  }

  @Test
  void vaultDaysFollowTheConfiguredZone() {
    var utc = new VaultSettings("UTC", List.of());
    var newYork = new VaultSettings("America/New_York", List.of());
    var lateEvening = Instant.parse("2026-09-26T02:00:00Z");

    assertThat(utc.day(lateEvening)).isEqualTo(LocalDate.of(2026, 9, 26));
    assertThat(newYork.day(lateEvening)).isEqualTo(LocalDate.of(2026, 9, 25));
  }

  @Test
  void vaultMilestonesAreLookedUpByWave() {
    var table = new LootTable(1, List.of(new LootEntry(1, item("DIAMOND"))));
    var vault =
        new VaultSettings(
            "UTC", List.of(new VaultMilestone(10, table), new VaultMilestone(20, table)));

    assertThat(vault.at(10)).isPresent();
    assertThat(vault.at(15)).isEmpty();
    assertThatThrownBy(
            () ->
                new VaultSettings(
                    "UTC", List.of(new VaultMilestone(10, table), new VaultMilestone(10, table))))
        .hasMessageContaining("two milestones");
    assertThatThrownBy(() -> new VaultSettings("Mars/Olympus", List.of()))
        .hasMessageContaining("time zone");
    assertThatThrownBy(() -> new VaultMilestone(0, table)).hasMessageContaining("wave");
  }

  @Test
  void lootIsPickedByWeight() {
    var table =
        new LootTable(
            3, List.of(new LootEntry(1, item("DIAMOND")), new LootEntry(3, item("IRON_INGOT"))));

    assertThat(table.pick(0).material()).isEqualTo("DIAMOND");
    assertThat(table.pick(1).material()).isEqualTo("IRON_INGOT");
    assertThat(table.pick(3).material()).isEqualTo("IRON_INGOT");
    assertThatThrownBy(() -> table.pick(4)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rollingGivesOneItemPerRollInProportion() {
    var table =
        new LootTable(
            20, List.of(new LootEntry(1, item("DIAMOND")), new LootEntry(9, item("IRON_INGOT"))));
    var random = RandomGenerator.of("L64X128MixRandom");
    var counts = new HashMap<String, Integer>();
    for (var i = 0; i < 500; i++) {
      for (var spec : table.roll(random)) {
        counts.merge(spec.material(), 1, Integer::sum);
      }
    }

    assertThat(counts.values().stream().mapToInt(Integer::intValue).sum()).isEqualTo(10_000);
    assertThat(counts.get("IRON_INGOT")).isBetween(8_600, 9_400);
  }

  @Test
  void lootTablesAndEntriesAreChecked() {
    assertThatThrownBy(() -> new LootTable(0, List.of(new LootEntry(1, item("DIAMOND")))))
        .hasMessageContaining("rolls");
    assertThatThrownBy(() -> new LootTable(1, List.of())).hasMessageContaining("entry");
    assertThatThrownBy(() -> new LootEntry(0, item("DIAMOND"))).hasMessageContaining("weight");
    var equipped =
        new ItemSpec(
            "IRON_HELMET", 1, Optional.empty(), Map.of(), Optional.empty(), Optional.of(Slot.HEAD));
    assertThatThrownBy(() -> new LootEntry(1, equipped)).hasMessageContaining("slot");
  }
}

package com.shepherdjerred.thestorm.npcs.domain.combat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger.Attack;
import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger.Response;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class NpcLedgerTest {
  private static final String WORLD = "minecraft:overworld";
  private final UUID alice = UUID.randomUUID();
  private final NpcLedger ledger = new NpcLedger();

  private Attack attack(String npc, long tick) {
    return new Attack(WORLD, npc, alice, tick);
  }

  @Test
  void twoWarningsArePerPlayerAndNpcButWantedStatusOverridesEveryAllowance() {
    assertThat(ledger.hit(attack("nat", 100), false)).isEqualTo(Response.FIRST_WARNING);
    assertThat(ledger.hit(attack("nat", 101), false)).isEqualTo(Response.FINAL_WARNING);
    assertThat(ledger.hit(attack("stan", 102), false)).isEqualTo(Response.FIRST_WARNING);
    assertThat(ledger.hit(new Attack(WORLD, "nat", UUID.randomUUID(), 102), false))
        .isEqualTo(Response.FIRST_WARNING);
    assertThat(ledger.hit(attack("nat", 103), false)).isEqualTo(Response.DEFEND);
    assertThat(ledger.hit(attack("thomas", 104), false)).isEqualTo(Response.DEFEND);
    assertThat(ledger.isWanted("minecraft:the_nether", alice, 104)).isFalse();
  }

  @Test
  void aLethalFirstHitCallsTheWatchImmediately() {
    assertThat(ledger.hit(attack("nat", 23_999), true)).isEqualTo(Response.DEFEND);
    assertThat(ledger.isWanted(WORLD, alice, 23_999)).isTrue();
    assertThat(ledger.isWanted(WORLD, alice, 24_000)).isFalse();
  }

  @Test
  void restoredDeathsAndOffensesExpireAtDawnIncludingSkippedDays() {
    ledger.hit(attack("nat", 23_999), false);
    ledger.accuse(WORLD, alice, 23_999);
    ledger.died(WORLD, "nat", 23_999);
    var restored = new NpcLedger();
    restored.restore(ledger.snapshot());
    assertThat(restored.awaitingDawn("nat")).isTrue();
    assertThat(restored.isWanted(WORLD, alice, 23_999)).isTrue();
    assertThat(restored.expire(Map.of(WORLD, 23_999L))).isFalse();
    assertThat(restored.expire(Map.of())).isFalse();
    assertThat(restored.expire(Map.of(WORLD, 72_000L))).isTrue();
    assertThat(restored.awaitingDawn("nat")).isFalse();
    assertThat(restored.snapshot()).isEqualTo(NpcLedger.Snapshot.empty());
    assertThat(restored.hit(attack("nat", 72_000), false)).isEqualTo(Response.FIRST_WARNING);
  }

  @Test
  void warningsResetOnTheWorldClockWithoutRequiringCleanup() {
    ledger.hit(attack("nat", 23_998), false);
    ledger.hit(attack("nat", 23_999), false);
    assertThat(ledger.hit(attack("nat", 24_000), false)).isEqualTo(Response.FIRST_WARNING);
    assertThat(NpcLedger.nextDawn(0)).isEqualTo(24_000);
    assertThat(NpcLedger.nextDawn(24_000)).isEqualTo(48_000);
    assertThat(NpcLedger.nextDawn(48_001)).isEqualTo(72_000);
  }

  @Test
  void snapshotsAreImmutableAndInvalidSavedStateFailsLoudly() {
    ledger.hit(attack("nat", 100), false);
    var snapshot = ledger.snapshot();
    ledger.hit(attack("nat", 101), false);
    assertThat(snapshot.warnings())
        .singleElement()
        .extracting(NpcLedger.Warning::hits)
        .isEqualTo(1);
    var duplicate =
        new NpcLedger.Snapshot(
            List.of(snapshot.warnings().getFirst(), snapshot.warnings().getFirst()),
            List.of(),
            List.of());
    assertThatThrownBy(() -> new NpcLedger().restore(duplicate))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new NpcLedger.Warning(WORLD, "nat", alice, 3, 24_000))
        .isInstanceOf(IllegalArgumentException.class);
  }
}

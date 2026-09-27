package com.shepherdjerred.thestorm.towns.domain.treasury;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownDirectory;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Every member sees and pays into the treasury; only owners and assistants take money out. */
final class TreasuryRulesTest {

  private final TownDirectory towns =
      new TownDirectory() {
        @Override
        public Optional<Town> townOf(UUID player) {
          return Optional.of(Fixtures.townA()).filter(town -> town.roleOf(player).isPresent());
        }

        @Override
        public Optional<Town> named(String name) {
          return Optional.empty();
        }
      };

  @Test
  void everyMemberUsesTheTreasury() {
    for (var player : new UUID[] {OWNER, ASSISTANT, MEMBER}) {
      assertThat(TreasuryRules.member(player, towns)).isEqualTo(Result.ok(Fixtures.townA()));
    }
    assertThat(TreasuryRules.member(NOMAD, towns))
        .isEqualTo(Result.err(new TreasuryProblem.NotInTown()));
  }

  @Test
  void onlyManagersWithdraw() {
    assertThat(TreasuryRules.withdrawer(OWNER, towns).isOk()).isTrue();
    assertThat(TreasuryRules.withdrawer(ASSISTANT, towns).isOk()).isTrue();
    assertThat(TreasuryRules.withdrawer(MEMBER, towns))
        .isEqualTo(Result.err(new TreasuryProblem.CannotWithdraw(TownRole.MEMBER)));
    assertThat(TreasuryRules.withdrawer(NOMAD, towns))
        .isEqualTo(Result.err(new TreasuryProblem.NotInTown()));
  }
}

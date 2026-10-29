package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.testing.RwfServerMock;
import java.util.Optional;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

/**
 * A disguised Spy must stay hittable by the enemy it fools. Paper's friendly-fire rule ({@code
 * Player.canHarmPlayer}) looks the attacker up on the attacker's own scoreboard and spares any
 * victim on that same team when the team forbids friendly fire. MockBukkit does not run that rule,
 * so {@link #sparedByFriendlyFire} applies it to the real boards.
 */
final class SpyFriendlyFireTest {

  private static final Optional<AbilityEffect.Disguised> SPY =
      Optional.of(new AbilityEffect.Disguised("spy", Optional.empty()));

  private ServerMock server;
  private Scoreboards boards;

  @BeforeEach
  void start() {
    server = MockBukkit.mock(RwfServerMock.create());
    boards = new Scoreboards(server);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  /**
   * Paper's {@code Player.canHarmPlayer}, negated: whether the attacker's team spares the victim.
   */
  private static boolean sparedByFriendlyFire(Player attacker, Player victim) {
    var team = attacker.getScoreboard().getEntryTeam(attacker.getName());
    return team != null && !team.allowFriendlyFire() && team.hasEntry(victim.getName());
  }

  private Player seat(String name, TeamColor team, boolean bot, boolean spy) {
    var player = server.addPlayer(name);
    if (spy) {
      // Kits start before seating, as in a match.
      boards.looks(player, false, SPY);
    }
    boards.assign(player, team, bot, false);
    return player;
  }

  @ParameterizedTest(name = "bot attacker {0}, bot spy {1}")
  @CsvSource({"false, false", "false, true", "true, false", "true, true"})
  void anEnemyCanHurtASpyWearingTheirColours(boolean botAttacker, boolean botSpy) {
    var attacker = seat("attacker", TeamColor.BLUE, botAttacker, false);
    var spy = seat("spy", TeamColor.RED, botSpy, true);

    assertThat(sparedByFriendlyFire(attacker, spy)).isFalse();
    assertThat(sparedByFriendlyFire(spy, attacker)).isFalse();
  }

  @ParameterizedTest(name = "bots {0}")
  @CsvSource({"false", "true"})
  void aSpysOwnTeamIsStillSparedIt(boolean bots) {
    var mate = seat("mate", TeamColor.RED, bots, false);
    var spy = seat("spy", TeamColor.RED, bots, true);

    assertThat(sparedByFriendlyFire(mate, spy)).isTrue();
    assertThat(sparedByFriendlyFire(spy, mate)).isTrue();
  }

  @Test
  void theEnemySeesTheSpyInTheirOwnColourWithItsBotMark() {
    var viewer = seat("viewer", TeamColor.BLUE, true, false);
    var spy = seat("spy", TeamColor.RED, true, true);

    var shown = requireNonNull(viewer.getScoreboard().getEntryTeam(spy.getName()));
    var own = requireNonNull(viewer.getScoreboard().getEntryTeam(viewer.getName()));
    assertThat(shown.getName()).isEqualTo(Scoreboards.spyName(TeamColor.BLUE, true));
    assertThat(shown.color()).isEqualTo(NamedTextColor.BLUE);
    assertThat(shown.suffix()).isEqualTo(own.suffix());
    assertThat(boards.teamOf(spy, TeamColor.RED))
        .isEqualTo(Scoreboards.teamName(TeamColor.RED, true));
  }
}

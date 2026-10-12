package com.shepherdjerred.thestorm.rwf.app.view;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOT_1;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.MATCH;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.BotActions;
import com.shepherdjerred.thestorm.rwf.app.BotBodies;
import com.shepherdjerred.thestorm.rwf.app.BotHandle;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

/** The flattened read models carry exactly what the snapshot and notification say. */
final class ViewsTest {

  private static MatchSnapshot snapshot() {
    return new MatchSnapshot(
        MATCH,
        MatchSnapshot.PhaseKind.LIVE,
        T0,
        Optional.of("harbour"),
        List.of(TeamColor.RED, TeamColor.BLUE),
        List.of(
            new MatchSnapshot.CombatantView(
                ALICE, "Alice", Optional.of(TeamColor.RED), Optional.of("trooper"), true),
            new MatchSnapshot.CombatantView(
                BOT_1, "Rusher", Optional.of(TeamColor.BLUE), Optional.of("longbow"), false)),
        List.of(
            new MatchSnapshot.BombView(
                "red-1",
                false,
                Optional.of(TeamColor.RED),
                Samples.RED_BOMB,
                new MatchSnapshot.BombView.State.Armed(
                    42,
                    Optional.of(
                        new MatchSnapshot.BombView.State.Arming(
                            TeamColor.RED, 0.25, List.of(ALICE))))),
            new MatchSnapshot.BombView(
                "nuke-1",
                true,
                Optional.empty(),
                Samples.NUKE,
                new MatchSnapshot.BombView.State.Idle())),
        Optional.of(new MatchSnapshot.PoisonView(PoisonClock.Stage.WARNED, Duration.ofSeconds(30))),
        Optional.of(new Outcome.Winner(TeamColor.BLUE)),
        Optional.empty());
  }

  @Test
  void theMatchStateFlattensTeamsCombatantsBombsAndPoison() {
    var state = MatchState.of(snapshot());

    assertThat(state.phase()).isEqualTo(MatchState.Phase.LIVE);
    assertThat(state.teams()).containsExactly("red", "blue");
    assertThat(state.combatant(ALICE.uuid()).orElseThrow().bot()).isFalse();
    var bot = state.combatant(BOT_1.uuid()).orElseThrow();
    assertThat(bot.personalityId()).contains("rusher");
    assertThat(bot.team()).contains("blue");
    assertThat(bot.alive()).isFalse();
    var bomb = state.bomb("red-1").orElseThrow();
    assertThat(bomb.team()).contains("red");
    assertThat(bomb.x()).isEqualTo(Samples.RED_BOMB.x());
    assertThat(bomb.status())
        .isEqualTo(
            new MatchState.Status.Armed(
                42,
                Optional.of(new MatchState.Status.Working("red", 0.25, List.of(ALICE.uuid())))));
    assertThat(state.bomb("nuke-1").orElseThrow().nuke()).isTrue();
    assertThat(state.poison()).contains(new MatchState.Poison(false, 30_000));
    assertThat(state.winner()).contains("blue");
  }

  @Test
  void theTransitionKeepsTheMapHashDeathsAndCombatantEffects() {
    var map = Samples.twoTeams();
    var chosen =
        Transition.of(new MatchNotification(new MatchEvent.MapChosen(map), List.of(), snapshot()));
    assertThat(chosen.change()).isEqualTo(new Transition.Change.MapChosen("harbour", Samples.SHA));

    var died =
        Transition.of(
            new MatchNotification(
                new MatchEvent.Died(BOT_1, Optional.of(ALICE), AttackType.MELEE, T0),
                List.of(
                    new MatchEffect.Spectate(BOT_1, Spawn.at(new BlockPos(0, 72, 0))),
                    new MatchEffect.Announce(
                        com.shepherdjerred.thestorm.rwf.domain.match.Notice.of(
                            com.shepherdjerred.thestorm.rwf.domain.match.NoticeKind.DRAW)),
                    new MatchEffect.Teleport(ALICE, new Spawn(new Vec3(1, 2, 3), 0, 0)),
                    new MatchEffect.RecordStat(ALICE, "Armed"),
                    new MatchEffect.Kill(List.of(BOT_1), AttackType.BOMB_EXPLODE)),
                snapshot()));
    assertThat(died.change())
        .isEqualTo(new Transition.Change.Died(BOT_1.uuid(), Optional.of(ALICE.uuid())));
    assertThat(died.effects())
        .containsExactly(
            new Transition.Effect.Spectating(BOT_1.uuid()),
            new Transition.Effect.Teleported(ALICE.uuid(), 1, 2, 3),
            new Transition.Effect.StatRecorded(ALICE.uuid(), "Armed"),
            new Transition.Effect.Killed(List.of(BOT_1.uuid())));
    assertThat(died.after().matchId()).isEqualTo(MATCH);
  }

  @Test
  void aRosterOverBodiesTranslatesHandlesBothWays() {
    var calls = new ArrayList<String>();
    var bodies =
        new BotBodies() {
          @Override
          public List<BotHandle> fill(UUID matchId, int slots) {
            return List.of(new BotHandle("rusher", BOT_1.uuid()));
          }

          @Override
          public void spawn(BotHandle bot, Location at) {
            calls.add("spawn " + bot.personalityId());
          }

          @Override
          public void despawn(BotHandle bot) {
            calls.add("despawn " + bot.uuid());
          }

          @Override
          public Optional<Player> entity(BotHandle bot) {
            return Optional.empty();
          }

          @Override
          public boolean isBot(UUID entity) {
            return entity.equals(BOT_1.uuid());
          }
        };
    var roster = BotRoster.of(bodies);

    assertThat(roster.fill(MATCH, 1)).containsExactly(BOT_1);
    roster.spawn(BOT_1, new Location(null, 0, 0, 0));
    roster.despawn(BOT_1);
    assertThat(calls).containsExactly("spawn rusher", "despawn " + BOT_1.uuid());
    assertThat(roster.isBot(BOT_1.uuid())).isTrue();
    assertThat(roster.entity(BOT_1)).isEmpty();
  }

  @Test
  void botActionsResolveUuidsThroughTheMatchAndRefuseStrangers() {
    var seen = new ArrayList<CombatantId>();
    var actions =
        new CombatantActions() {
          @Override
          public Optional<ActionRefusal> clickBomb(CombatantId id, String bombId) {
            seen.add(id);
            return Optional.empty();
          }

          @Override
          public Optional<ActionRefusal> useRewind(CombatantId id) {
            seen.add(id);
            return Optional.of(ActionRefusal.COOLING_DOWN);
          }

          @Override
          public Optional<ActionRefusal> melee(CombatantId attacker, CombatantId target) {
            seen.add(attacker);
            seen.add(target);
            return Optional.empty();
          }

          @Override
          public Optional<ActionRefusal> shootBow(CombatantId id, Vec3 direction, double force) {
            seen.add(id);
            return direction.equals(new Vec3(0, 1, 0))
                ? Optional.empty()
                : Optional.of(ActionRefusal.BAD_FORCE);
          }

          @Override
          public Optional<ActionRefusal> consume(CombatantId id, int slot) {
            seen.add(id);
            return Optional.empty();
          }

          @Override
          public Optional<ActionRefusal> pickKit(CombatantId id, String kitId) {
            seen.add(id);
            return Optional.empty();
          }
        };
    var bots = BotActions.over(actions, () -> Optional.of(snapshot()));

    assertThat(bots.clickBomb(BOT_1.uuid(), "red-1")).isEmpty();
    assertThat(bots.useRewind(BOT_1.uuid())).contains(ActionRefusal.COOLING_DOWN);
    assertThat(bots.melee(BOT_1.uuid(), ALICE.uuid())).isEmpty();
    assertThat(bots.shootBow(BOT_1.uuid(), new Point(0, 1, 0), 1)).isEmpty();
    assertThat(bots.consume(BOT_1.uuid(), 2)).isEmpty();
    assertThat(bots.pickKit(BOT_1.uuid(), "longbow")).isEmpty();
    assertThat(bots.clickBomb(UUID.randomUUID(), "red-1")).contains(ActionRefusal.NOT_A_MEMBER);
    assertThat(bots.melee(BOT_1.uuid(), UUID.randomUUID())).contains(ActionRefusal.NOT_A_MEMBER);
    assertThat(seen).containsExactly(BOT_1, BOT_1, BOT_1, ALICE, BOT_1, BOT_1, BOT_1);
  }
}

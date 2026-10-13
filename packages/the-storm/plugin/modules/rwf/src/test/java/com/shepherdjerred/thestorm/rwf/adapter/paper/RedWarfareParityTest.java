package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot.BombView;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot.CombatantView;
import com.shepherdjerred.thestorm.rwf.domain.match.Notice;
import com.shepherdjerred.thestorm.rwf.domain.match.NoticeKind;
import com.shepherdjerred.thestorm.rwf.domain.match.Score;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.Test;

/** The sidebar, holograms and broadcasts read as Red Warfare's did. */
final class RedWarfareParityTest {

  private static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  private static List<String> plain(List<Component> lines) {
    return lines.stream().map(RedWarfareParityTest::plain).toList();
  }

  private static CombatantView fighter(int n, TeamColor team, boolean alive) {
    return new CombatantView(
        new CombatantId.Human(new UUID(0, n)),
        "p" + n,
        Optional.of(team),
        Optional.of("trooper"),
        alive,
        Score.ZERO);
  }

  private static BombView bomb(String id, boolean nuke, TeamColor team, BombView.State state) {
    return new BombView(
        id, nuke, Optional.of(team), new BlockPos(0, 64, 0), state, BombView.progressOf(state));
  }

  private static MatchSnapshot live(List<CombatantView> fighters, List<BombView> bombs) {
    return new MatchSnapshot(
        new UUID(0, 1),
        MatchSnapshot.PhaseKind.LIVE,
        Instant.EPOCH,
        Optional.of("harbour"),
        List.of(TeamColor.RED, TeamColor.BLUE, TeamColor.GREEN),
        fighters,
        bombs,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        Optional.empty());
  }

  @Test
  void theGameBoardListsLivingTeamsMostAliveFirstWithTheirBombsThenTheNukes() {
    var snapshot =
        live(
            List.of(
                fighter(1, TeamColor.RED, true),
                fighter(2, TeamColor.BLUE, true),
                fighter(3, TeamColor.BLUE, true),
                fighter(4, TeamColor.GREEN, false)),
            List.of(
                bomb("red-1", false, TeamColor.RED, new BombView.State.Armed(42, Optional.empty())),
                bomb("blue-1", false, TeamColor.BLUE, new BombView.State.Idle()),
                bomb("green-1", false, TeamColor.GREEN, new BombView.State.Idle()),
                bomb("nuke-1", true, TeamColor.BLUE, new BombView.State.Idle())));

    assertThat(plain(Scoreboards.lines(snapshot)))
        .containsExactly(
            "Blue Team",
            "2 alive",
            "Bomb is Safe",
            "",
            "Red Team",
            "1 alive",
            "Bomb 42",
            "",
            "Nuke");
  }

  @Test
  void aBombBeingDefusedShowsTheBarAndTheTimeAndAnArmedNukeItsArmer() {
    var defusing = new BombView.State.Arming(TeamColor.RED, 0.5, List.of());
    var snapshot =
        live(
            List.of(fighter(1, TeamColor.RED, true)),
            List.of(
                bomb(
                    "red-1",
                    false,
                    TeamColor.RED,
                    new BombView.State.Armed(17, Optional.of(defusing))),
                bomb(
                    "nuke-1", true, TeamColor.RED, new BombView.State.Armed(9, Optional.empty()))));

    var lines = Scoreboards.lines(snapshot);

    assertThat(plain(lines)).containsExactly("Red Team", "1 alive", "▍▍▍▍▍▍▍▍▍▍ 17", "", "Nuke 9");
    assertThat(lines.get(4).color()).isEqualTo(NamedTextColor.RED);
  }

  @Test
  void theLobbyBoardIsRedWarfaresWaitingBoard() {
    var waiting = new LobbyStatus(LobbyStatus.Stage.WAITING, Optional.empty(), 1, 0, 3, 0, 0.25);
    var counting =
        new LobbyStatus(LobbyStatus.Stage.COUNTDOWN, Optional.of("Harbour"), 2, 6, 0, 41, 0.5);

    assertThat(plain(Scoreboards.lobbyLines(waiting)))
        .containsExactly("", "Map: Voting..", "Players: 1", "", "Waiting for 3 players");
    assertThat(plain(Scoreboards.lobbyLines(counting)))
        .containsExactly("", "Map: Harbour", "Players: 8", "", "Game starting in 41");
    assertThat(plain(Scoreboards.GAME_TITLE)).isEqualTo("Teams");
    assertThat(plain(Scoreboards.LOBBY_TITLE)).isEqualTo("Red Warfare");
  }

  @Test
  void theHologramIsTheTeamsBombAnUnarmedNukeOrTheCountdown() {
    var site =
        new com.shepherdjerred.thestorm.rwf.domain.map.BombSite(
            "red-1",
            new com.shepherdjerred.thestorm.rwf.domain.map.BombOwner.Team(TeamColor.RED),
            new BlockPos(0, 64, 0));
    var nuke =
        new com.shepherdjerred.thestorm.rwf.domain.map.BombSite(
            "nuke-1",
            new com.shepherdjerred.thestorm.rwf.domain.map.BombOwner.Nuke(),
            new BlockPos(0, 64, 0));

    assertThat(
            plain(
                BombMarkers.text(
                    site, bomb("red-1", false, TeamColor.RED, new BombView.State.Idle()))))
        .isEqualTo("Red Team's Bomb");
    assertThat(
            plain(
                BombMarkers.text(
                    nuke, bomb("nuke-1", true, TeamColor.RED, new BombView.State.Idle()))))
        .isEqualTo("Unarmed nuke");
    assertThat(
            plain(
                BombMarkers.text(
                    site,
                    bomb(
                        "red-1",
                        false,
                        TeamColor.RED,
                        new BombView.State.Armed(30, Optional.empty())))))
        .isEqualTo("Exploding in 30");
  }

  @Test
  void broadcastsUseRedWarfaresWording() {
    assertThat(
            plain(
                Texts.original(
                        Notice.of(NoticeKind.TEAM_SIZE, Map.of("count", "1", "team", "Red Team")))
                    .orElseThrow()))
        .isEqualTo("There are 1 player in Red Team");
    assertThat(
            plain(
                Texts.original(
                        Notice.of(
                            NoticeKind.LAST_MAN_STANDING,
                            Map.of("player", "Alice", "team", "Red Team")))
                    .orElseThrow()))
        .isEqualTo("Alice is last man standing!");
    assertThat(
            plain(
                Texts.original(
                        Notice.of(
                            NoticeKind.BOMB_ARMED,
                            Map.of("team", "Red Team", "owner", "Blue Team")))
                    .orElseThrow()))
        .isEqualTo("ab Red Team just armed Blue Team's bomb! ab");
    assertThat(
            plain(
                Texts.original(
                        Notice.of(
                            NoticeKind.FUSE_WARNING,
                            Map.of("seconds", "1", "team", "Red Team", "bomb", "bomb")))
                    .orElseThrow()))
        .isEqualTo("1 second left until Red Team's bomb goes off!");
    assertThat(Texts.render(Notice.of(NoticeKind.COUNTDOWN, "seconds", 90)))
        .isEqualTo("The game will begin in 1 minute, 30 seconds");
    assertThat(Texts.original(Notice.of(NoticeKind.JOINED, "player", "Alice"))).isEmpty();
  }

  @Test
  void timeAnswersAsRedWarfaresTimeCommandDid() {
    assertThat(
            plain(Texts.timeProgress(Duration.ofSeconds(125), Optional.of(Duration.ofSeconds(61)))))
        .containsExactly(
            "The game has been in progress for 2 minutes, 5 seconds",
            "Poison will begin in 1 minute, 1 second");
    assertThat(plain(Texts.timeProgress(Duration.ofSeconds(1), Optional.empty())))
        .containsExactly("The game has been in progress for 1 second");
  }
}

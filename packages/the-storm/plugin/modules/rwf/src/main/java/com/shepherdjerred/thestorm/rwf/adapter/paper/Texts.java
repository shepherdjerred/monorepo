package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static java.util.Map.entry;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.Notice;
import com.shepherdjerred.thestorm.rwf.domain.match.NoticeKind;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Server;
import org.jspecify.annotations.Nullable;

/** Renders the match's messages in the house style, with Red Warfare's wording. */
final class Texts {

  static final String LABEL = "RWF";

  /** Told to every human as they enter, as the recording disclosure. */
  static final String RECORDING_DISCLOSURE =
      "Matches are recorded (positions, actions, results) under a pseudonym for review and bot"
          + " training. Leave with /rwf leave if you would rather not be recorded.";

  private static final Set<NoticeKind> GOOD =
      EnumSet.of(
          NoticeKind.KIT_PICKED,
          NoticeKind.GAME_BEGUN,
          NoticeKind.BOMB_DEFUSED,
          NoticeKind.NUKE_DEFUSED,
          NoticeKind.TEAM_WINS,
          NoticeKind.CREDITS_GIVEN);

  private static final Set<NoticeKind> BAD =
      EnumSet.of(
          NoticeKind.COUNTDOWN_CANCELLED,
          NoticeKind.BOMB_ARMED,
          NoticeKind.NUKE_ARMED,
          NoticeKind.FUSE_WARNING,
          NoticeKind.BOMB_EXPLODED,
          NoticeKind.NUKE_EXPLODED,
          NoticeKind.TEAM_DEFEATED,
          NoticeKind.POISON_WARNING,
          NoticeKind.POISON_BEGUN,
          NoticeKind.STOPPED,
          NoticeKind.AFK_PENALTY);

  private static final Map<NoticeKind, String> TEMPLATES =
      Map.ofEntries(
          entry(NoticeKind.JOINED, "{player} joined the match."),
          entry(NoticeKind.LEFT, "{player} left the match."),
          entry(NoticeKind.KIT_PICKED, "Now using kit {kit}"),
          entry(NoticeKind.COUNTDOWN, "The game will begin in {time}"),
          entry(NoticeKind.COUNTDOWN_CANCELLED, "The countdown stopped: not enough players."),
          entry(NoticeKind.GAME_BEGUN, "The game has begun!"),
          entry(NoticeKind.YOU_ARE_IN_TEAM, "You are in {team}"),
          entry(NoticeKind.TEAM_SIZE, "There are {count} {players} in {team}"),
          entry(NoticeKind.BOMB_ARMED, "ab {team} just armed {owner}'s bomb! ab"),
          entry(NoticeKind.NUKE_ARMED, "ab {team} just armed a nuke! ab"),
          entry(NoticeKind.BOMB_DEFUSED, "{team} has just defused their bomb!"),
          entry(NoticeKind.NUKE_DEFUSED, "{team} has just defused {owner}'s nuke!"),
          entry(NoticeKind.FUSE_WARNING, "{time} left until {team}'s {bomb} goes off!"),
          entry(NoticeKind.BOMB_EXPLODED, "{team}'s bomb exploded!"),
          entry(NoticeKind.NUKE_EXPLODED, "{team}'s nuke exploded! Everyone but them annihilated!"),
          entry(NoticeKind.TEAM_DEFEATED, "{team} was defeated!"),
          entry(NoticeKind.LAST_MAN_STANDING, "{player} is last man standing!"),
          entry(NoticeKind.POISON_WARNING, "One minute until players start dying!"),
          entry(NoticeKind.POISON_BEGUN, "Don't say I didn't warn you!"),
          entry(NoticeKind.TEAM_WINS, "{team} wins!"),
          entry(NoticeKind.DRAW, "No one won!"),
          entry(NoticeKind.STOPPED, "The match was stopped."),
          entry(NoticeKind.CREDITS_GIVEN, "Given {credits} {creditWord}"),
          entry(
              NoticeKind.AFK_PENALTY,
              "You were AFK all match: you earned nothing and {credits} credits were taken."),
          entry(NoticeKind.DEATH, "{template}"),
          entry(NoticeKind.KILL_ASSIST, "Scored a kill assist worth {share}!"),
          entry(NoticeKind.STOLEN_KILL, "Stolen a kill!"),
          entry(NoticeKind.KILLER_HEALTH, "Your killer has {hearts} ❤ left."),
          entry(NoticeKind.BALLOT_OPEN, "Vote for the next map with /rwf vote: {maps}."),
          entry(NoticeKind.VOTED, "You voted for {map}."),
          entry(NoticeKind.MAP_CHOSEN, "{map} by {author} won the vote with {votes} votes."),
          entry(NoticeKind.MAP_FAILED, "{map} could not be loaded; the vote goes on without it."),
          entry(NoticeKind.PREVIEW, "Previewing {map} by {author}. Change kit while you look."),
          entry(NoticeKind.FREEZE, "Get ready: the match starts in {seconds} seconds."));

  private static final Map<MatchError, String> ERRORS =
      Map.ofEntries(
          entry(MatchError.ALREADY_JOINED, "You are already in the match."),
          entry(MatchError.IN_PROGRESS, "A match is under way. Wait for the next one."),
          entry(MatchError.FULL, "The match is full."),
          entry(MatchError.NOT_A_MEMBER, "You are not in the match."),
          entry(MatchError.NOT_PRE_GAME, "You can only do that before the match starts."),
          entry(MatchError.UNKNOWN_KIT, "There is no such kit."),
          entry(MatchError.NO_MAP, "No map is ready yet."),
          entry(MatchError.MAP_LOCKED, "The map cannot change once the match has started."),
          entry(MatchError.TOO_FEW_PLAYERS, "Too few players to start."),
          entry(MatchError.NOT_LIVE, "The match is not live."),
          entry(MatchError.NOT_ALIVE, "You are not alive."),
          entry(MatchError.UNKNOWN_BOMB, "There is no such bomb."),
          entry(MatchError.BOMB_DESTROYED, "That bomb is gone."),
          entry(MatchError.CANNOT_ARM_OWN_BOMB, "You cannot arm your own bomb!"),
          entry(MatchError.CANNOT_DEFUSE_ENEMY_BOMB, "You cannot disarm the enemy's bomb!"),
          entry(MatchError.CANNOT_DEFUSE_OWN_NUKE, "You cannot disarm your team's nuke!"),
          entry(MatchError.NOT_RESETTING, "The map is not resetting."),
          entry(MatchError.ALREADY_RESETTING, "The map is already resetting."),
          entry(MatchError.NO_BALLOT, "There is no map vote open."),
          entry(MatchError.BALLOT_ALREADY_OPEN, "A map vote is already open."),
          entry(MatchError.NOT_ON_BALLOT, "That map is not on the ballot."),
          entry(MatchError.VOTE_CLOSED, "The map vote has closed."),
          entry(MatchError.NOTHING_TO_SKIP, "Nothing is waiting that could be moved on."),
          entry(MatchError.UNKNOWN_TEAM, "That team does not play on this map."));

  private static final Map<ActionRefusal, String> REFUSALS =
      Map.ofEntries(
          entry(ActionRefusal.NOT_A_MEMBER, describe(MatchError.NOT_A_MEMBER)),
          entry(ActionRefusal.NO_ENTITY, "You are not in the world."),
          entry(ActionRefusal.NOT_ALIVE, describe(MatchError.NOT_ALIVE)),
          entry(ActionRefusal.NOT_LIVE, describe(MatchError.NOT_LIVE)),
          entry(ActionRefusal.NOT_PRE_GAME, describe(MatchError.NOT_PRE_GAME)),
          entry(ActionRefusal.UNKNOWN_KIT, describe(MatchError.UNKNOWN_KIT)),
          entry(ActionRefusal.UNKNOWN_BOMB, describe(MatchError.UNKNOWN_BOMB)),
          entry(ActionRefusal.BOMB_DESTROYED, describe(MatchError.BOMB_DESTROYED)),
          entry(ActionRefusal.CANNOT_ARM_OWN_BOMB, describe(MatchError.CANNOT_ARM_OWN_BOMB)),
          entry(
              ActionRefusal.CANNOT_DEFUSE_ENEMY_BOMB,
              describe(MatchError.CANNOT_DEFUSE_ENEMY_BOMB)),
          entry(ActionRefusal.CANNOT_DEFUSE_OWN_NUKE, describe(MatchError.CANNOT_DEFUSE_OWN_NUKE)),
          entry(ActionRefusal.BOMB_OUT_OF_REACH, "You are too far from the bomb."),
          entry(ActionRefusal.NO_FUSE, "You have no Bomb Fuse."),
          entry(ActionRefusal.OUT_OF_REACH, "Your target is out of reach."),
          entry(ActionRefusal.NO_LINE_OF_SIGHT, "You cannot see your target."),
          entry(ActionRefusal.SAME_TEAM, "That is your team mate."),
          entry(ActionRefusal.HIT_WINDOW, "Your target was hit too recently."),
          entry(ActionRefusal.NO_BOW, "You are not holding a bow with arrows."),
          entry(ActionRefusal.BAD_FORCE, "The bow force must be between 0 and 1."),
          entry(ActionRefusal.NOTHING_TO_CONSUME, "There is nothing to eat in that slot."),
          entry(ActionRefusal.FULL_HEALTH, "You are too healthy to eat that."),
          entry(ActionRefusal.NO_TIME_MACHINE, "You have no Time Machine."),
          entry(
              ActionRefusal.COOLING_DOWN,
              "Your timestream is too unstable! Attempting to use it now would kill you!"),
          entry(ActionRefusal.NO_LANDING, "No landing spots found in the last 10 seconds!"));

  private Texts() {}

  /** The notices that only go out with the death feed on. */
  static final Set<NoticeKind> DEATH_FEED =
      EnumSet.of(
          NoticeKind.DEATH,
          NoticeKind.KILL_ASSIST,
          NoticeKind.STOLEN_KILL,
          NoticeKind.KILLER_HEALTH);

  static void notice(Audience to, Notice notice) {
    if (notice.kind() == NoticeKind.DEATH) {
      to.sendMessage(death(notice));
      return;
    }
    var original = original(notice);
    if (original.isPresent()) {
      to.sendMessage(original.orElseThrow());
      return;
    }
    var text = Component.text(render(notice));
    var kind = notice.kind();
    if (GOOD.contains(kind)) {
      to.sendMessage(HouseStyle.success(LABEL, text));
    } else if (BAD.contains(kind)) {
      to.sendMessage(HouseStyle.error(LABEL, text));
    } else {
      to.sendMessage(HouseStyle.info(LABEL, text));
    }
  }

  /** Tells each online player charged the AFK penalty what was actually taken. */
  static void charged(Server server, List<PayoutService.Paid> paid) {
    for (var payment : paid) {
      var player = server.getPlayer(payment.player());
      if (payment.owed() < 0 && player != null) {
        notice(player, Notice.of(NoticeKind.AFK_PENALTY, "credits", -payment.paid()));
      }
    }
  }

  static void info(Audience to, String text) {
    to.sendMessage(HouseStyle.info(LABEL, Component.text(text)));
  }

  static void success(Audience to, String text) {
    to.sendMessage(HouseStyle.success(LABEL, Component.text(text)));
  }

  static void error(Audience to, String text) {
    to.sendMessage(HouseStyle.error(LABEL, Component.text(text)));
  }

  static void error(Audience to, MatchError error) {
    error(to, describe(error));
  }

  static void error(Audience to, ActionRefusal refusal) {
    error(to, describe(refusal));
  }

  /** The message for {@code notice}, placeholders filled, as plain text. */
  static String render(Notice notice) {
    var text = Objects.requireNonNull(TEMPLATES.get(notice.kind()), "every notice has a template");
    for (var entry : derived(notice).entrySet()) {
      text = text.replace("{" + entry.getKey() + "}", entry.getValue());
    }
    for (var entry : notice.values().entrySet()) {
      text = text.replace("{" + entry.getKey() + "}", entry.getValue());
    }
    if (notice.kind() == NoticeKind.DEATH) {
      text =
          text.replace(KILLED, notice.values().getOrDefault("killed", "?"))
              .replace(KILLER, notice.values().getOrDefault("killer", "?"));
    }
    return text;
  }

  /** The values Red Warfare's wording needs that a notice carries in another form. */
  private static Map<String, String> derived(Notice notice) {
    return switch (notice.kind()) {
      case COUNTDOWN, FUSE_WARNING ->
          Map.of("time", time(Long.parseLong(value(notice, "seconds"))));
      case TEAM_SIZE ->
          Map.of("players", "1".equals(value(notice, "count")) ? "player" : "players");
      case CREDITS_GIVEN ->
          Map.of("creditWord", "1".equals(value(notice, "credits")) ? "credit" : "credits");
      default -> Map.of();
    };
  }

  /**
   * A duration as Red Warfare wrote it ({@code UtilNumber.getTime}): "1 minute, 30 seconds", "5
   * seconds", "1 second", or "no time at all".
   */
  static String time(long seconds) {
    var parts = new ArrayList<String>();
    long[][] units = {{3600, 0}, {60, 1}, {1, 2}};
    String[] names = {"hour", "minute", "second"};
    var left = Math.abs(seconds);
    for (var unit : units) {
      var amount = left / unit[0];
      left %= unit[0];
      if (amount > 0) {
        var name = names[(int) unit[1]];
        parts.add(amount + " " + name + (amount == 1 ? "" : "s"));
      }
    }
    return parts.isEmpty() ? "no time at all" : String.join(", ", parts);
  }

  /**
   * The notices Red Warfare broadcast itself, in its own colours and without the house label; empty
   * for the ones this port added (joining, the vote, the preview), which keep the house style.
   */
  static Optional<Component> original(Notice notice) {
    var kind = notice.kind();
    var plain = PLAIN.get(kind);
    if (plain != null) {
      return Optional.of(Component.text(render(notice), plain));
    }
    if (kind == NoticeKind.TEAM_WINS || kind == NoticeKind.LAST_MAN_STANDING) {
      return Optional.of(Component.text(render(notice), colorOf(value(notice, "team"))));
    }
    return Optional.ofNullable(mixed(notice));
  }

  /** Red Warfare's one-colour broadcasts, in their colour. */
  private static final Map<NoticeKind, NamedTextColor> PLAIN =
      Map.ofEntries(
          entry(NoticeKind.GAME_BEGUN, NamedTextColor.GOLD),
          entry(NoticeKind.KIT_PICKED, NamedTextColor.BLUE),
          entry(NoticeKind.COUNTDOWN, NamedTextColor.RED),
          entry(NoticeKind.POISON_WARNING, NamedTextColor.RED),
          entry(NoticeKind.POISON_BEGUN, NamedTextColor.RED),
          entry(NoticeKind.DRAW, NamedTextColor.GOLD),
          entry(NoticeKind.CREDITS_GIVEN, NamedTextColor.GOLD),
          entry(NoticeKind.KILL_ASSIST, NamedTextColor.DARK_RED),
          entry(NoticeKind.STOLEN_KILL, NamedTextColor.DARK_RED));

  /** Red Warfare's broadcasts that colour team names within gold text; null for the others. */
  private static @Nullable Component mixed(Notice notice) {
    var gold = NamedTextColor.GOLD;
    return switch (notice.kind()) {
      case YOU_ARE_IN_TEAM ->
          Component.text("You are in ", gold).append(team(value(notice, "team")));
      case TEAM_SIZE ->
          Component.text(
                  "There are "
                      + value(notice, "count")
                      + " "
                      + value(derived(notice), "players")
                      + " in ",
                  gold)
              .append(team(value(notice, "team")));
      case BOMB_ARMED ->
          magic()
              .append(named(" ", value(notice, "team"), ""))
              .append(Component.text(" just armed ", gold))
              .append(named("", value(notice, "owner"), "'s"))
              .append(Component.text(" bomb! ", gold))
              .append(magic());
      case NUKE_ARMED ->
          magic()
              .append(named(" ", value(notice, "team"), ""))
              .append(Component.text(" just armed a nuke! ", gold))
              .append(magic());
      case BOMB_DEFUSED ->
          team(value(notice, "team")).append(Component.text(" has just defused their bomb!", gold));
      case NUKE_DEFUSED ->
          team(value(notice, "team"))
              .append(Component.text(" has just defused ", gold))
              .append(named("", value(notice, "owner"), "'s "))
              .append(Component.text("nuke!", gold));
      case FUSE_WARNING ->
          Component.text(value(derived(notice), "time") + " left until ", gold)
              .append(named("", value(notice, "team"), "'s "))
              .append(Component.text(value(notice, "bomb") + " goes off!", gold));
      case BOMB_EXPLODED ->
          named("", value(notice, "team"), "'s ").append(Component.text("bomb exploded!", gold));
      case NUKE_EXPLODED ->
          named("", value(notice, "team"), "'s ")
              .append(Component.text("nuke exploded! Everyone but them annihilated!", gold));
      case TEAM_DEFEATED ->
          team(value(notice, "team")).append(Component.text(" was defeated!", gold));
      case KILLER_HEALTH ->
          Component.text("Your killer has ", NamedTextColor.GRAY)
              .append(Component.text(value(notice, "hearts") + " ❤", NamedTextColor.DARK_RED))
              .append(Component.text(" left.", NamedTextColor.GRAY));
      default -> null;
    };
  }

  /**
   * Red Warfare's {@code /time} answer ({@code SearchAndDestroy.sendTimeProgress}): how long the
   * game has run and, until the poison bites, when it will, in grey chat lines.
   */
  static List<Component> timeProgress(Duration running, Optional<Duration> untilPoison) {
    var lines = new ArrayList<Component>();
    lines.add(
        Component.text(
            "The game has been in progress for " + time(running.toSeconds()), NamedTextColor.GRAY));
    untilPoison
        .filter(left -> !left.isNegative() && !left.isZero())
        .ifPresent(
            left ->
                lines.add(
                    Component.text(
                        "Poison will begin in " + time(left.toSeconds()), NamedTextColor.GRAY)));
    return List.copyOf(lines);
  }

  /** The notice's {@code key}: every notice carries the values its wording names. */
  private static String value(Notice notice, String key) {
    return value(notice.values(), key);
  }

  private static String value(Map<String, String> values, String key) {
    return Objects.requireNonNull(values.get(key), () -> "a notice without " + key);
  }

  /** Red Warfare's obfuscated "ab" around an arming announcement. */
  private static Component magic() {
    return Component.text("ab", NamedTextColor.GOLD, TextDecoration.OBFUSCATED);
  }

  /** {@code team}'s name in its colour. */
  private static Component team(String team) {
    return Component.text(team, colorOf(team));
  }

  /** {@code before}, {@code team}'s name, and {@code after}, all in the team's colour. */
  private static Component named(String before, String team, String after) {
    return Component.text(before + team + after, colorOf(team));
  }

  /** A team's colour from its display name ("Red Team"). */
  private static NamedTextColor colorOf(String team) {
    return Arrays.stream(TeamColor.values())
        .filter(color -> color.displayName().equals(team))
        .findFirst()
        .map(Scoreboards::color)
        .orElse(NamedTextColor.GOLD);
  }

  private static final String KILLED = "%Killed%";
  private static final String KILLER = "%Killer%";

  /**
   * A death message as Red Warfare broadcast it: the attack type's line in yellow with the victim
   * and the killer in their team colours.
   */
  static Component death(Notice notice) {
    var template = notice.values().getOrDefault("template", "%Killed% died");
    var line = Component.text();
    var rest = template;
    while (!rest.isEmpty()) {
      var killed = rest.indexOf(KILLED);
      var killer = rest.indexOf(KILLER);
      var next = nextToken(killed, killer);
      if (next < 0) {
        line.append(Component.text(rest, NamedTextColor.YELLOW));
        break;
      }
      if (next > 0) {
        line.append(Component.text(rest.substring(0, next), NamedTextColor.YELLOW));
      }
      var isVictim = next == killed;
      var name = notice.values().getOrDefault(isVictim ? "killed" : "killer", "");
      var team = notice.values().getOrDefault(isVictim ? "killedTeam" : "killerTeam", "");
      line.append(Component.text(name.isEmpty() ? "someone" : name, teamColor(team)));
      rest = rest.substring(next + (isVictim ? KILLED.length() : KILLER.length()));
    }
    return line.build();
  }

  private static int nextToken(int a, int b) {
    if (a < 0) {
      return b;
    }
    return b < 0 ? a : Math.min(a, b);
  }

  private static NamedTextColor teamColor(String team) {
    return Arrays.stream(TeamColor.values())
        .filter(color -> color.name().equals(team))
        .findFirst()
        .map(Scoreboards::color)
        .orElse(NamedTextColor.YELLOW);
  }

  /** The fixed wording for a refusal. */
  static String describe(MatchError error) {
    return Objects.requireNonNull(ERRORS.get(error), "every error has wording");
  }

  static String describe(ActionRefusal refusal) {
    return Objects.requireNonNull(REFUSALS.get(refusal), "every refusal has wording");
  }
}

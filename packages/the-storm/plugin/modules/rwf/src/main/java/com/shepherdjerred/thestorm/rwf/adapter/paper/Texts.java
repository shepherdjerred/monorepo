package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static java.util.Map.entry;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.Notice;
import com.shepherdjerred.thestorm.rwf.domain.match.NoticeKind;
import java.util.EnumSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;

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
          NoticeKind.STOPPED);

  private static final Map<NoticeKind, String> TEMPLATES =
      Map.ofEntries(
          entry(NoticeKind.JOINED, "{player} joined the match."),
          entry(NoticeKind.LEFT, "{player} left the match."),
          entry(NoticeKind.KIT_PICKED, "Now using kit {kit}."),
          entry(NoticeKind.COUNTDOWN, "The game will begin in {seconds} seconds."),
          entry(NoticeKind.COUNTDOWN_CANCELLED, "The countdown stopped: not enough players."),
          entry(NoticeKind.GAME_BEGUN, "The game has begun!"),
          entry(NoticeKind.YOU_ARE_IN_TEAM, "You are in {team}."),
          entry(NoticeKind.TEAM_SIZE, "There are {count} players in {team}."),
          entry(NoticeKind.BOMB_ARMED, "{team} just armed {owner}'s bomb!"),
          entry(NoticeKind.NUKE_ARMED, "{team} just armed a nuke!"),
          entry(NoticeKind.BOMB_DEFUSED, "{team} has just defused their bomb!"),
          entry(NoticeKind.NUKE_DEFUSED, "{team} has just defused {owner}'s nuke!"),
          entry(NoticeKind.FUSE_WARNING, "{seconds} seconds left until {team}'s {bomb} goes off!"),
          entry(NoticeKind.BOMB_EXPLODED, "{team}'s bomb exploded!"),
          entry(
              NoticeKind.NUKE_EXPLODED,
              "{team}'s nuke exploded! Everyone but them was annihilated!"),
          entry(NoticeKind.TEAM_DEFEATED, "{team} was defeated!"),
          entry(NoticeKind.LAST_MAN_STANDING, "{player} is the last one standing for {team}!"),
          entry(NoticeKind.POISON_WARNING, "One minute until players start dying!"),
          entry(NoticeKind.POISON_BEGUN, "Don't say I didn't warn you!"),
          entry(NoticeKind.TEAM_WINS, "{team} wins!"),
          entry(NoticeKind.DRAW, "No one won!"),
          entry(NoticeKind.STOPPED, "The match was stopped."),
          entry(NoticeKind.CREDITS_GIVEN, "You earned {credits} credits."));

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
          entry(MatchError.ALREADY_RESETTING, "The map is already resetting."));

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
              "Your timestream is too unstable! Using it now would kill you!"),
          entry(ActionRefusal.NO_LANDING, "No landing spots found!"));

  private Texts() {}

  static void notice(Audience to, Notice notice) {
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

  /** The message for {@code notice}, placeholders filled. */
  static String render(Notice notice) {
    var text = Objects.requireNonNull(TEMPLATES.get(notice.kind()), "every notice has a template");
    for (var entry : notice.values().entrySet()) {
      text = text.replace("{" + entry.getKey() + "}", entry.getValue());
    }
    return text;
  }

  /** The fixed wording for a refusal. */
  static String describe(MatchError error) {
    return Objects.requireNonNull(ERRORS.get(error), "every error has wording");
  }

  static String describe(ActionRefusal refusal) {
    return Objects.requireNonNull(REFUSALS.get(refusal), "every refusal has wording");
  }
}

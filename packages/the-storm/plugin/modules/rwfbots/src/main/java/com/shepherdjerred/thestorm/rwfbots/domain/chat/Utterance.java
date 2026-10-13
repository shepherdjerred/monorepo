package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * One line a bot will say.
 *
 * @param speaker the bot
 * @param name the bot's name as players see it
 * @param team the bot's team display name; empty in the lobby, before teams exist
 * @param moment which pool the line came from
 * @param template the line as authored, placeholders intact
 * @param text the line with its placeholders filled
 * @param at when to say it
 */
public record Utterance(
    UUID speaker,
    String name,
    Optional<String> team,
    Lines.Moment moment,
    String template,
    String text,
    Instant at) {

  /**
   * The calls a team keeps to itself: finishing arming a bomb, defusing one's own, and the last of
   * a team calling out. Everything else is banter for everyone.
   */
  public static final Set<Lines.Moment> TEAM_MOMENTS =
      Set.copyOf(
          EnumSet.of(Lines.Moment.ON_PLANT, Lines.Moment.ON_DEFUSE, Lines.Moment.ON_LAST_ALIVE));

  /** Whether only the speaker's team should hear it: a team call, once teams exist. */
  public boolean teamOnly() {
    return team.isPresent() && TEAM_MOMENTS.contains(moment);
  }
}

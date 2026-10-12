package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import java.util.Optional;
import java.util.UUID;

/** Something in the lobby or a live match a bot might react to in chat. */
public sealed interface ChatMoment {

  /** The match went live: bots may greet. */
  record Started() implements ChatMoment {}

  /**
   * A combatant died: the killer may brag, the victim may react.
   *
   * @param victim who died
   * @param killer who killed them, when a combatant did (not a bomb, poison or a fall)
   */
  record Died(UUID victim, Optional<UUID> killer) implements ChatMoment {}

  /**
   * A bomb finished arming; every armer is a candidate.
   *
   * @param planter one of the combatants who armed it
   * @param bomb the bomb as players read it, such as {@code Blue Team's bomb} or {@code the nuke}
   * @param nuke whether it is a nuke
   */
  record Planted(UUID planter, String bomb, boolean nuke) implements ChatMoment {}

  /**
   * An armed bomb was defused.
   *
   * @param defuser one of the combatants who defused it
   * @param bomb the bomb as players read it
   */
  record Defused(UUID defuser, String bomb) implements ChatMoment {}

  /**
   * The match ended.
   *
   * @param winner the winning team's display name; empty for a draw
   */
  record Ended(Optional<String> winner) implements ChatMoment {}

  /**
   * Nothing happened for a while: a chance for an idle taunt when one is due, or before the match a
   * little lobby small talk.
   */
  record Idle() implements ChatMoment {}

  /**
   * A bot walked into the lobby: it may say hello.
   *
   * @param bot the bot
   */
  record Arrived(UUID bot) implements ChatMoment {}

  /**
   * A human in the lobby said something in chat: one bot may answer, in kind when it was a
   * greeting.
   *
   * @param human who spoke
   * @param text what they said, as plain text
   */
  record HumanSaid(UUID human, String text) implements ChatMoment {}

  /** The countdown is nearly over: one bot may say something about it. */
  record CountdownCall() implements ChatMoment {}
}

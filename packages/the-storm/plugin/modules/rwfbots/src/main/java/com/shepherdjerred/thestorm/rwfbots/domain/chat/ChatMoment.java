package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import java.util.Optional;
import java.util.UUID;

/** Something in a live match a bot might react to in chat. */
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

  /** Nothing happened for a while: a chance for an idle taunt when one is due. */
  record Idle() implements ChatMoment {}
}

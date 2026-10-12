package com.shepherdjerred.thestorm.chat.app;

import java.util.Optional;
import java.util.UUID;
import java.util.function.Predicate;

/**
 * Lets an NPC (such as a Search and Destroy bot) talk in a channel. Its line passes the same mutes,
 * filters and repeat limits as a player's, is routed by the channel's reach and membership, and
 * respects each viewer's hidden channels and ignores; it is never relayed outside the game.
 * Provided by the chat module. Main thread only.
 */
public interface NpcChat {

  /** Says {@code line}; empty when it was said, otherwise why chat refused it, for logs. */
  Optional<String> say(Line line);

  /**
   * One NPC line.
   *
   * @param id the NPC's entity id, which membership channels resolve like a player's
   * @param name the name players see, as plain text
   * @param channel where it goes; a membership channel needs the NPC in a registered group
   * @param text what it says, as plain text
   * @param prefix trusted MiniMessage shown before the name in place of the prefix provider's (such
   *     as a team-coloured mark); empty for none. Never put player text here.
   * @param audience the only players who may hear it, on top of the channel's own reach (for
   *     example, the players in the NPC's world)
   */
  record Line(
      UUID id,
      String name,
      ChatChannel channel,
      String text,
      String prefix,
      Predicate<UUID> audience) {

    public Line {
      if (name.isBlank()) {
        throw new IllegalArgumentException("an NPC line needs a name");
      }
    }
  }
}

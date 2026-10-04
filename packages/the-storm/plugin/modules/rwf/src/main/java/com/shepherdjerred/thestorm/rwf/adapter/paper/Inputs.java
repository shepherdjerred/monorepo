package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Input;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInputEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * The movement keys each online player last reported, as {@link InputFrame} key bits. The server
 * starts every login with nothing held and Paper raises {@link PlayerInputEvent} on every change,
 * so a player with no entry holds nothing. Tracked in every world, so keys held while joining the
 * match are known. Main thread only.
 */
final class Inputs implements Listener {

  private final Map<UUID, Integer> keys = new HashMap<>();

  /** What {@code player} holds now. */
  int keys(UUID player) {
    return keys.getOrDefault(player, InputFrame.NONE);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onInput(PlayerInputEvent event) {
    var bits = bits(event.getInput());
    if (bits == InputFrame.NONE) {
      keys.remove(event.getPlayer().getUniqueId());
    } else {
      keys.put(event.getPlayer().getUniqueId(), bits);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    keys.remove(event.getPlayer().getUniqueId());
  }

  static int bits(Input input) {
    return (input.isForward() ? InputFrame.FORWARD : 0)
        | (input.isBackward() ? InputFrame.BACKWARD : 0)
        | (input.isLeft() ? InputFrame.LEFT : 0)
        | (input.isRight() ? InputFrame.RIGHT : 0)
        | (input.isJump() ? InputFrame.JUMP : 0)
        | (input.isSneak() ? InputFrame.SNEAK : 0)
        | (input.isSprint() ? InputFrame.SPRINT : 0);
  }
}

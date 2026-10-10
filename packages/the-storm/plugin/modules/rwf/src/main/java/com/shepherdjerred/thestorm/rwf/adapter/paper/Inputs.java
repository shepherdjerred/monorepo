package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.record.ControlPacket;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Input;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInputEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.messaging.PluginMessageListener;

/**
 * The movement keys each online player last reported, as {@link InputFrame} key bits. The server
 * starts every login with nothing held and Paper raises {@link PlayerInputEvent} on every change,
 * so a player with no entry holds nothing. Tracked in every world, so keys held while joining the
 * match are known. Main thread only.
 */
final class Inputs implements Listener, PluginMessageListener {

  private final Map<UUID, Integer> keys = new HashMap<>();
  private final Map<UUID, Sample> samples = new HashMap<>();
  private final Map<UUID, Long> consumed = new HashMap<>();

  private record Sample(ControlPacket packet, int receivedAt) {}

  @Override
  public void onPluginMessageReceived(String channel, Player player, byte[] bytes) {
    if (!channel.equals(ControlPacket.CHANNEL)) return;
    final ControlPacket packet;
    try {
      packet = ControlPacket.decode(bytes);
    } catch (IllegalArgumentException invalid) {
      return; // Untrusted optional client message; it is never a complete training label.
    }
    var id = player.getUniqueId();
    if (packet.observationTick() > player.getServer().getCurrentTick()) return;
    var previous = samples.get(id);
    if (previous != null && packet.sequence() <= previous.packet().sequence()) return;
    samples.put(id, new Sample(packet, player.getServer().getCurrentTick()));
  }

  InputFrame frame(long tick, String pseudonym, Player player, long liveTick) {
    var id = player.getUniqueId();
    var sample = samples.get(id);
    if (sample != null
        && sample.packet().sequence() > consumed.getOrDefault(id, -1L)
        && player.getServer().getCurrentTick() - sample.receivedAt() <= 1) {
      consumed.put(id, sample.packet().sequence());
      return sample.packet().frame(tick, pseudonym, liveTick);
    }
    var location = Places.at(player);
    return new InputFrame(
        tick,
        pseudonym,
        keys(id),
        InputFrame.quantizeYaw(location.getYaw()),
        InputFrame.quantizePitch(location.getPitch()),
        false,
        false,
        player.getInventory().getHeldItemSlot(),
        -1,
        -1,
        InputFrame.Source.MISSING);
  }

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
    samples.remove(event.getPlayer().getUniqueId());
    consumed.remove(event.getPlayer().getUniqueId());
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

package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.messages.domain.Channel;
import com.shepherdjerred.thestorm.messages.domain.ShuffleBag;
import java.util.List;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import org.bukkit.Server;

/**
 * Broadcasts one announcement per run, such as {@code [Tips]: ...}, to the console and to every
 * player who has not muted the channel. Messages come up in shuffled rounds. Runs on the main
 * thread from the scheduler.
 */
public final class Announcer implements Runnable {

  private final Channel channel;
  private final String label;
  private final List<Component> messages;
  private final Audience audience;
  private ShuffleBag bag;

  /**
   * Where announcements go and how the next one is picked.
   *
   * @param server the online players and the console
   * @param preferences each player's muted channels
   * @param random shuffles each round
   */
  public record Audience(Server server, PreferenceStore preferences, RandomGenerator random) {}

  public Announcer(Channel channel, String label, List<Component> messages, Audience audience) {
    this.channel = channel;
    this.label = label;
    this.messages = List.copyOf(messages);
    this.audience = audience;
    this.bag = ShuffleBag.of(this.messages.size());
  }

  @Override
  public void run() {
    var draw = bag.draw(audience.random());
    bag = draw.next();
    var announcement = HouseStyle.info(label, messages.get(draw.index()));
    audience.server().getConsoleSender().sendMessage(announcement);
    for (var player : audience.server().getOnlinePlayers()) {
      if (audience.preferences().read(player).hears(channel)) {
        player.sendMessage(announcement);
      }
    }
  }
}

package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.shepherdjerred.thestorm.messages.domain.Cycle;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServerListPingEvent;

/**
 * Shows the next MOTD on every server-list ping. Pings can arrive off the main thread, so the
 * rotation advances with a compare-and-set over a random-free {@link Cycle}.
 */
public final class MotdListener implements Listener {

  private final List<Component> motds;
  private final AtomicReference<Cycle> cycle;

  /** {@code motds} are the complete two-line messages. */
  public MotdListener(List<Component> motds) {
    this.motds = List.copyOf(motds);
    this.cycle = new AtomicReference<>(Cycle.of(this.motds.size()));
  }

  @EventHandler
  public void onPing(ServerListPingEvent event) {
    var shown = cycle.getAndUpdate(Cycle::next);
    event.motd(motds.get(shown.position()));
  }
}

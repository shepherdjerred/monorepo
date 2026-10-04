package com.shepherdjerred.thestorm.agent.adapter.paper;

import com.shepherdjerred.thestorm.agent.app.AgentConfig;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/**
 * Greets first-joiners with the staff voice: starter tips and where to read more. Essentials
 * already teleports and kits them; this lands a few seconds later so it never buries the arrival
 * messages. A player the server has seen before is never greeted, so reinstalls and restarts stay
 * quiet.
 */
public final class AgentJoinListener implements Listener {

  private static final Duration GREETING_DELAY = Duration.ofSeconds(3);

  private final AgentConfig.OnboardingFile onboarding;
  private final Scheduler scheduler;

  public AgentJoinListener(AgentConfig.OnboardingFile onboarding, Scheduler scheduler) {
    this.onboarding = onboarding;
    this.scheduler = scheduler;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    if (!onboarding.enabled()) {
      return;
    }
    var player = event.getPlayer();
    if (player.hasPlayedBefore()) {
      return;
    }
    var lines = onboarding.lines();
    scheduler.runOnMainThreadLater(
        GREETING_DELAY,
        () -> {
          if (player.isOnline()) {
            for (var line : lines) {
              player.sendMessage(Component.text(line));
            }
          }
        });
  }
}

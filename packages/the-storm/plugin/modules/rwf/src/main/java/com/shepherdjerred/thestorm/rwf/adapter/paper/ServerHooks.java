package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.destroystokyo.paper.entity.ai.MobGoals;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import java.util.function.BiPredicate;
import java.util.function.Consumer;
import org.bukkit.Bukkit;
import org.bukkit.entity.Display;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/**
 * The server operations tests replace, because MockBukkit does not implement them: chunk tickets,
 * display entities' billboard mode, line-of-sight ray casts, the hurt animation and mob goals.
 *
 * @param chunks keeps map chunks loaded
 * @param displayStyle styles a display entity (a bomb hologram, the lobby's texts and kit items)
 *     once spawned
 * @param lineOfSight whether the first entity can see the second
 * @param hurt shows a player the red flash of being hit
 * @param mobGoals the goals mobs pursue, for the killstreak golem's Red Warfare AI
 */
public record ServerHooks(
    ChunkHolder chunks,
    Consumer<Display> displayStyle,
    BiPredicate<LivingEntity, LivingEntity> lineOfSight,
    Consumer<Player> hurt,
    MobGoals mobGoals) {

  /**
   * The real server: shared chunk tickets, displays facing the viewer, real ray casts, the server's
   * mob goals.
   */
  public static ServerHooks production(ChunkTickets tickets) {
    return new ServerHooks(
        ChunkHolder.shared(tickets),
        display -> display.setBillboard(Display.Billboard.CENTER),
        LivingEntity::hasLineOfSight,
        player -> player.sendHurtAnimation(0),
        Bukkit.getMobGoals());
  }
}

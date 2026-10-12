package com.shepherdjerred.thestorm.tools.conversionguard;

import java.util.Set;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFadeEvent;
import org.bukkit.event.block.BlockFormEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockGrowEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.BlockPhysicsEvent;
import org.bukkit.event.block.BlockSpreadEvent;
import org.bukkit.event.block.LeavesDecayEvent;
import org.bukkit.event.block.MoistureChangeEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.hanging.HangingBreakEvent;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.server.ServerLoadEvent;
import org.bukkit.event.weather.LightningStrikeEvent;
import org.bukkit.event.weather.ThunderChangeEvent;
import org.bukkit.event.weather.WeatherChangeEvent;
import org.bukkit.event.world.StructureGrowEvent;
import org.bukkit.event.world.WorldInitEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Startup-only conversion harness. Tick freeze is supplemented by destructive-event vetoes. */
public final class ConversionGuard extends JavaPlugin implements Listener {
  private static final Set<String> GENERATED_SPAWNS =
      Set.of(
          "NATURAL",
          "SPAWNER",
          "TRIAL_SPAWNER",
          "PATROL",
          "RAID",
          "REINFORCEMENTS",
          "CHUNK_GEN",
          "VILLAGE_INVASION",
          "VILLAGE_DEFENSE");

  @Override
  public void onEnable() {
    getServer().getServerTickManager().setFrozen(true);
    getServer().getPluginManager().registerEvents(this, this);
    getLogger()
        .info("CONVERSION_GUARD_READY: ticks frozen before world initialization; logins denied");
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void world(WorldInitEvent event) {
    getServer().getServerTickManager().setFrozen(true);
  }

  @EventHandler
  public void ready(ServerLoadEvent event) {
    if (!getServer().getServerTickManager().isFrozen()
        || !getServer().getOnlinePlayers().isEmpty()) {
      throw new IllegalStateException("Conversion server admission or tick freeze failed");
    }
    getLogger().info("CONVERSION_GUARD_VERIFIED: frozen=true; players=0");
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void login(AsyncPlayerPreLoginEvent event) {
    event.disallow(
        AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
        Component.text("This isolated server is converting an archive."));
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void spawn(CreatureSpawnEvent event) {
    if (GENERATED_SPAWNS.contains(event.getSpawnReason().name())) event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void burn(BlockBurnEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void fade(BlockFadeEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void form(BlockFormEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void flow(BlockFromToEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void grow(BlockGrowEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void ignite(BlockIgniteEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void physics(BlockPhysicsEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void spread(BlockSpreadEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void leaves(LeavesDecayEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void entityBlock(EntityChangeBlockEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void damage(EntityDamageEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void explode(EntityExplodeEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void blockExplosion(BlockExplodeEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void moisture(MoistureChangeEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void hanging(HangingBreakEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void lightning(LightningStrikeEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void thunder(ThunderChangeEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void weather(WeatherChangeEvent event) {
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void structure(StructureGrowEvent event) {
    event.setCancelled(true);
  }
}

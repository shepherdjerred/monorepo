package com.shepherdjerred.thestorm.seasonal.adapter.paper;

import com.shepherdjerred.thestorm.seasonal.domain.AnnualWindow;
import com.shepherdjerred.thestorm.seasonal.domain.DailyDoors;
import com.shepherdjerred.thestorm.seasonal.domain.SeasonalConfig;
import java.time.InstantSource;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Door;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/** Main-world spawn doors grant one weighted item outcome per door each event day. */
public final class SeasonalDoors implements Listener {

  private final Plugin plugin;
  private final SeasonalConfig config;
  private final InstantSource time;
  private final RandomGenerator random;
  private final ZoneId zone;
  private final Map<String, AnnualWindow> windows;

  public SeasonalDoors(
      Plugin plugin, SeasonalConfig config, InstantSource time, RandomGenerator random) {
    this.plugin = plugin;
    this.config = config;
    this.time = time;
    this.random = random;
    this.zone = config.zone();
    this.windows =
        config.events().stream()
            .collect(
                java.util.stream.Collectors.toUnmodifiableMap(
                    SeasonalConfig.Event::id, SeasonalConfig.Event::window));
    for (var event : config.events()) {
      for (var reward : event.rewards()) {
        var material = Material.getMaterial(reward.material());
        if (material == null || !material.isItem() || material == Material.AIR) {
          throw new IllegalArgumentException("invalid seasonal item: " + reward.material());
        }
      }
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onDoor(PlayerInteractEvent interaction) {
    if (interaction.getHand() != EquipmentSlot.HAND
        || interaction.getAction() != Action.RIGHT_CLICK_BLOCK) {
      return;
    }
    var block = interaction.getClickedBlock();
    if (block == null || !(block.getBlockData() instanceof Door door)) {
      return;
    }
    var player = interaction.getPlayer();
    if (!player.getWorld().getName().equals(config.mainWorld())) {
      return;
    }
    var today = LocalDate.ofInstant(time.instant(), zone);
    var lower = door.getHalf() == Bisected.Half.TOP ? block.getRelative(0, -1, 0) : block;
    for (var event : config.events()) {
      var window = windows.get(event.id());
      if (window == null) {
        throw new IllegalStateException("missing seasonal window: " + event.id());
      }
      if (window.contains(today) && nearSpawn(lower, event.spawnRadius())) {
        visit(player, lower, event, today);
      }
    }
  }

  private static boolean nearSpawn(Block door, int radius) {
    var spawn = door.getWorld().getSpawnLocation();
    long dx = (long) door.getX() - spawn.getBlockX();
    long dz = (long) door.getZ() - spawn.getBlockZ();
    return dx * dx + dz * dz <= (long) radius * radius;
  }

  private void visit(Player player, Block door, SeasonalConfig.Event event, LocalDate today) {
    var key = new NamespacedKey(plugin, "seasonal_" + event.id());
    var container = player.getPersistentDataContainer();
    var stored = container.get(key, PersistentDataType.STRING);
    var state = stored == null ? new DailyDoors(today, Set.of()) : DailyDoors.parse(stored, today);
    var coordinate = door.getX() + "," + door.getY() + "," + door.getZ();
    var claim = state.claim(coordinate, event.dailyDoors());
    switch (claim.status()) {
      case ALREADY_VISITED ->
          player.sendMessage(Component.text("You already visited this door today."));
      case DAILY_LIMIT ->
          player.sendMessage(Component.text("You have visited every door for today."));
      case GRANTED -> {
        container.set(key, PersistentDataType.STRING, claim.state().serialize());
        var reward = draw(event, random);
        var item = new ItemStack(Material.valueOf(reward.material()), reward.amount());
        Map<Integer, ItemStack> overflow = player.getInventory().addItem(item);
        for (var stack : overflow.values()) {
          door.getWorld().dropItemNaturally(door.getLocation(), stack);
        }
        player.sendMessage(
            Component.text(
                event.title()
                    + ": "
                    + (reward.kind() == SeasonalConfig.Kind.TRICK ? "A trick! " : "A treat! ")
                    + reward.amount()
                    + " "
                    + item.getType().name().toLowerCase(Locale.ROOT).replace('_', ' ')));
      }
    }
  }

  private static SeasonalConfig.Reward draw(SeasonalConfig.Event event, RandomGenerator random) {
    var total = event.rewards().stream().mapToInt(SeasonalConfig.Reward::weight).sum();
    var ticket = random.nextInt(total);
    for (var reward : event.rewards()) {
      ticket -= reward.weight();
      if (ticket < 0) {
        return reward;
      }
    }
    throw new IllegalStateException("weighted seasonal draw exhausted");
  }
}

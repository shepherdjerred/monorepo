package com.shepherdjerred.thestorm.quests.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.npcs.app.NpcDirectory;
import com.shepherdjerred.thestorm.npcs.app.NpcMarkers;
import com.shepherdjerred.thestorm.npcs.app.QuestMarker;
import com.shepherdjerred.thestorm.quests.app.QuestWorld;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.engine.Facts;
import com.shepherdjerred.thestorm.quests.domain.engine.KillCredit;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Action.NpcMark;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Region;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.ItemStack;

/** {@link QuestWorld} on a live Paper server. Main thread. */
final class PaperWorld implements QuestWorld {

  private record Removed(List<ItemStack> stacks) implements TakenItems {
    private Removed {
      stacks = List.copyOf(stacks);
    }
  }

  /**
   * What the world needs.
   *
   * @param spawnedMobLife how long quest-spawned creatures live
   */
  record Parts(
      Server server,
      Scheduler scheduler,
      QuestContent content,
      TrackLevels tracks,
      Protection protection,
      NpcDirectory npcs,
      NpcMarkers markers,
      SidebarDisplay sidebars,
      String mainWorld,
      Duration spawnedMobLife) {}

  private final Parts parts;

  PaperWorld(Parts parts) {
    this.parts = parts;
  }

  @Override
  public Optional<Facts> facts(UUID player) {
    return player(player).map(found -> new PaperFacts(found, parts.tracks(), parts.content()));
  }

  @Override
  public Optional<Player> player(UUID player) {
    return Optional.ofNullable(parts.server().getPlayer(player))
        .filter(Player::isOnline)
        .filter(found -> found.getWorld().getName().equals(parts.mainWorld()));
  }

  @Override
  public void give(UUID player, ItemMatch item, int amount) {
    player(player)
        .ifPresent(
            found -> {
              for (var stack : ItemStacks.make(item, amount)) {
                found
                    .getInventory()
                    .addItem(stack)
                    .values()
                    .forEach(left -> found.getWorld().dropItem(Locations.of(found), left));
              }
            });
  }

  @Override
  public Optional<TakenItems> take(UUID player, ItemMatch item, int amount) {
    var found = player(player);
    if (found.isEmpty() || ItemStacks.count(found.get(), item) < amount) {
      return Optional.empty();
    }
    var removed = ItemStacks.take(found.get(), item, amount);
    if (removed.stream().mapToInt(ItemStack::getAmount).sum() != amount) {
      throw new IllegalStateException("quest item handover changed after its count check");
    }
    return Optional.of(new Removed(removed));
  }

  @Override
  public void restore(UUID player, TakenItems taken) {
    var found =
        player(player)
            .orElseThrow(
                () ->
                    new IllegalStateException("cannot restore quest items outside the main world"));
    var removed = (Removed) taken;
    for (var stack : removed.stacks()) {
      found
          .getInventory()
          .addItem(stack.clone())
          .values()
          .forEach(left -> found.getWorld().dropItem(Locations.of(found), left));
    }
  }

  @Override
  public void teleport(UUID player, Region region) {
    player(player)
        .ifPresent(
            found -> {
              var destination = location(region);
              if (destination.isEmpty()) {
                return;
              }
              switch (parts
                  .protection()
                  .check(player, ProtectedAction.TELEPORT_INTO, destination.get())) {
                case Decision.Allowed() -> {
                  var _ =
                      found.teleportAsync(
                          destination.get(), PlayerTeleportEvent.TeleportCause.PLUGIN);
                }
                case Decision.Denied(var reason) -> found.sendMessage(reason);
              }
            });
  }

  @Override
  public void spawn(UUID player, Action.Spawn spawn, Region region) {
    var at = location(region);
    if (at.isEmpty() || player(player).isEmpty()) {
      return;
    }
    var type = EntityType.valueOf(spawn.entity());
    for (var index = 0; index < spawn.count(); index++) {
      var entity = at.get().getWorld().spawnEntity(at.get(), type);
      entity.addScoreboardTag(KillCredit.QUEST_SPAWNED);
      spawn
          .name()
          .ifPresent(
              name -> {
                entity.customName(Component.text(name));
                entity.setCustomNameVisible(true);
              });
      entity.setPersistent(false);
      var _ = parts.scheduler().runOnMainThreadLater(parts.spawnedMobLife(), entity::remove);
    }
  }

  @Override
  public void send(UUID player, Component message) {
    player(player).ifPresent(found -> found.sendMessage(message));
  }

  @Override
  public void actionBar(UUID player, Component message) {
    player(player).ifPresent(found -> found.sendActionBar(message));
  }

  @Override
  public void markers(UUID player, Map<String, NpcMark> marks) {
    player(player)
        .ifPresent(
            found ->
                marks.forEach(
                    (npc, mark) -> {
                      if (parts.npcs().find(npc).isPresent()) {
                        parts.markers().set(found, npc, marker(mark));
                      }
                    }));
  }

  @Override
  public void sidebar(UUID player, Optional<Journal.Sidebar> sidebar) {
    player(player).ifPresent(found -> parts.sidebars().show(found, sidebar));
  }

  private Optional<Location> location(Region region) {
    return Optional.ofNullable(parts.server().getWorld(Key.key(region.world())))
        .map(world -> new Location(world, region.x(), region.y(), region.z()));
  }

  static QuestMarker marker(NpcMark mark) {
    return switch (mark) {
      case NONE -> QuestMarker.NONE;
      case AVAILABLE -> QuestMarker.AVAILABLE;
      case TURN_IN -> QuestMarker.TURN_IN;
    };
  }
}

package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon;
import com.shepherdjerred.thestorm.arena.domain.survival.MysteryBox;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/** Shared box animation has a private claim and follows authored sites behind purchased routes. */
final class ZombiesBox {
  private final SurvivalRunner runner;
  private final MysteryBox box;
  private final Map<UUID, Integer> refunds = new HashMap<>();
  private @Nullable ItemDisplay display;
  private @Nullable Cancellable animation;
  private int frame;
  private boolean revealed;

  ZombiesBox(SurvivalRunner runner) {
    this.runner = runner;
    box =
        new MysteryBox(
            runner.map().content().boxSites().stream().map(SurvivalContent.BoxSite::id).toList());
  }

  String active() {
    return box.site();
  }

  String status(SurvivalContent.BoxSite site) {
    if (!site.id().equals(active())) return "Dormant mystery box";
    return box.roll().isPresent() ? "Mystery box · reserved" : "ACTIVE · 16 emeralds · right-click";
  }

  private SurvivalContent.BoxSite site() {
    return runner.map().content().boxSites().stream()
        .filter(s -> s.id().equals(box.site()))
        .findFirst()
        .orElseThrow();
  }

  boolean interact(Player player, BlockPos pos) {
    var candidate =
        runner.map().content().boxSites().stream()
            .filter(s -> s.block().equals(pos) || s.beacon().equals(pos))
            .findFirst();
    if (candidate.isEmpty()) return false;
    var clicked = candidate.orElseThrow();
    if (clicked.beacon().equals(pos)) return true;
    if (!runner.map().state().accessible(clicked.zone())) {
      Texts.info(player, "Open the " + clicked.zone() + " route before using this box.");
      return true;
    }
    if (!clicked.id().equals(active())) {
      Texts.info(player, "The active box is in " + site().zone() + ". Follow its magenta beacon.");
      return true;
    }
    if (!runner.machines().powered()) {
      Texts.error(player, "Restore power at the foundry first.");
      runner.feedback().play(player, SurvivalFeedback.Cue.FAILURE);
      return true;
    }
    var roll = box.roll();
    if (roll.isPresent()) {
      if (!roll.orElseThrow().owner().equals(player.getUniqueId())) {
        Texts.info(player, "This roll belongs to another survivor. Wait for their claim.");
      } else claim(player, roll.orElseThrow());
      return true;
    }
    var free =
        java.util.Arrays.stream(
                java.util.Objects.requireNonNull(player.getInventory().getStorageContents()))
            .filter(i -> i == null || i.isEmpty())
            .count();
    if (free < 2) {
      Texts.error(player, "Make two inventory slots free for the reward and ammunition.");
      return true;
    }
    if (!runner.items().spend(player, Map.of("EMERALD", 16))) return true;
    if (!box.start(player.getUniqueId(), reward(), runner.context().time().instant()))
      throw new IllegalStateException("Charged a busy mystery box");
    revealed = false;
    frame = 0;
    var at = Places.location(player.getWorld(), site().block().center()).add(0, 1.2, 0);
    display =
        player
            .getWorld()
            .spawn(
                at,
                ItemDisplay.class,
                entity -> {
                  entity.setPersistent(false);
                  entity.setItemDisplayTransform(ItemDisplay.ItemDisplayTransform.GROUND);
                  runner.tag(entity);
                });
    lid(true);
    animation =
        runner
            .context()
            .scheduler()
            .repeatOnMainThread(Duration.ZERO, Duration.ofMillis(100), this::animate);
    Texts.info(player, "Mystery box rolling… right-click again to claim after the reveal.");
    return true;
  }

  private String reward() {
    var roll = runner.context().random().nextInt(100);
    if (roll < 30) return "IRON_SWORD";
    if (roll < 50) return "BOW";
    if (roll < 70) return "CROSSBOW";
    if (roll < 85) return "DIAMOND_SWORD";
    if (roll < 95) return "TRIDENT";
    var rewards = runner.map().content().legendaries();
    var pick =
        runner
            .context()
            .random()
            .nextInt(rewards.stream().mapToInt(SurvivalContent.LegendaryReward::weight).sum());
    for (var reward : rewards) {
      pick -= reward.weight();
      if (pick < 0) return "legendary:" + reward.id();
    }
    throw new IllegalStateException("Legendary weights did not resolve");
  }

  private List<ItemStack> bundle(String reward) {
    var weapon =
        reward.startsWith("legendary:")
            ? runner
                .items()
                .legendary(LegendaryWeapon.valueOf(reward.substring("legendary:".length())))
            : runner.items().stack(SurvivalItems.material(reward), 1);
    if (weapon.getType() == Material.BOW)
      weapon.addEnchantment(org.bukkit.enchantments.Enchantment.POWER, 1);
    if (weapon.getType() == Material.BOW || weapon.getType() == Material.CROSSBOW)
      return List.of(weapon, runner.items().stack(Material.ARROW, 32));
    if (runner.items().legendary(weapon).filter(id -> id == LegendaryWeapon.GRAVITON).isPresent())
      return List.of(weapon, runner.items().stack(Material.REDSTONE, 16));
    return List.of(weapon);
  }

  private void claim(Player player, MysteryBox.Roll roll) {
    var now = runner.context().time().instant();
    if (now.isBefore(roll.reveal())) {
      Texts.info(player, "The box is still rolling.");
      return;
    }
    if (!now.isBefore(roll.expires())) {
      tick();
      return;
    }
    if (!runner.items().deliver(player, bundle(roll.reward()))) {
      Texts.error(player, "Make room, then claim before the reveal expires.");
      return;
    }
    if (!box.claim(player.getUniqueId(), now))
      throw new IllegalStateException("Delivered an unclaimable box reward");
    clearDisplay();
    runner.feedback().play(player, SurvivalFeedback.Cue.PURCHASE);
    Texts.info(
        player, "Mystery box reward: " + roll.reward().replace("legendary:", "Legendary · "));
    if (box.relocate(
        runner.context().random().nextInt(1, runner.map().content().boxSites().size()))) {
      beams();
      runner
          .online()
          .forEach(
              p ->
                  Texts.info(
                      p,
                      "The mystery box moved to "
                          + site().zone()
                          + ". Follow the magenta beacon; open its route if needed."));
    }
  }

  private void animate() {
    var roll = box.roll();
    var item = display;
    if (roll.isEmpty() || item == null) {
      clearDisplay();
      return;
    }
    var now = runner.context().time().instant();
    if (!now.isBefore(roll.orElseThrow().reveal())) {
      item.setItemStack(bundle(roll.orElseThrow().reward()).getFirst());
      if (!revealed) {
        revealed = true;
        var buyer = runner.context().server().getPlayer(roll.orElseThrow().owner());
        if (buyer != null) {
          buyer.playSound(item.getLocation(), Sound.BLOCK_NOTE_BLOCK_CHIME, .9f, 1.5f);
          runner.hud().hint(buyer, "Reward ready · right-click the box · 15 seconds to claim", 3);
        }
      }
      return;
    }
    var previews =
        new Material[] {
          Material.IRON_SWORD,
          Material.BOW,
          Material.CROSSBOW,
          Material.DIAMOND_SWORD,
          Material.TRIDENT,
          Material.BLAZE_ROD
        };
    item.setItemStack(ItemStack.of(previews[frame % previews.length]));
    item.setRotation(frame * 18, 0);
    if (frame % 3 == 0) {
      var buyer = runner.context().server().getPlayer(roll.orElseThrow().owner());
      if (buyer != null)
        buyer.playSound(
            item.getLocation(), Sound.BLOCK_NOTE_BLOCK_HAT, .4f, Math.min(2, .6f + frame * .04f));
    }
    frame++;
  }

  void tick() {
    box.expire(runner.context().time().instant())
        .ifPresent(
            roll -> {
              refunds.merge(roll.owner(), 16, Integer::sum);
              clearDisplay();
            });
    for (var entry : List.copyOf(refunds.entrySet())) {
      var player = runner.context().server().getPlayer(entry.getKey());
      if (player != null
          && runner.isFighter(entry.getKey())
          && runner
              .items()
              .deliver(player, List.of(runner.items().stack(Material.EMERALD, entry.getValue())))) {
        refunds.remove(entry.getKey());
        Texts.info(player, "Unclaimed mystery box refunded " + entry.getValue() + " emeralds.");
      }
    }
  }

  void beams() {
    for (var candidate : runner.map().content().boxSites()) {
      var block = runner.world().block(candidate.beacon());
      block.setType(candidate.id().equals(active()) ? Material.BEACON : Material.AIR, false);
      if (block.getState() instanceof org.bukkit.block.Beacon beacon) {
        beacon.setPrimaryEffect(null);
        beacon.setSecondaryEffect(null);
        beacon.update(true, false);
      }
    }
  }

  private void lid(boolean open) {
    if (runner.world().block(site().block()).getState() instanceof org.bukkit.block.Chest chest) {
      if (open) chest.open();
      else chest.close();
    }
  }

  private void clearDisplay() {
    if (animation != null) {
      animation.cancel();
      animation = null;
    }
    if (display != null) {
      display.remove();
      display = null;
    }
    lid(false);
  }

  void leave(UUID id) {
    box.cancel(id)
        .ifPresent(
            roll -> {
              refunds.merge(id, 16, Integer::sum);
              clearDisplay();
            });
    refunds.remove(id);
  }

  void reset() {
    clearDisplay();
    box.reset();
    if (runner.world().chunksReady()) beams();
    refunds.clear();
  }
}

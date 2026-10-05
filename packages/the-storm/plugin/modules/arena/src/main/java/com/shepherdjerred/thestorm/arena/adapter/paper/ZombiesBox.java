package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon;
import com.shepherdjerred.thestorm.arena.domain.survival.MysteryBox;
import com.shepherdjerred.thestorm.arena.domain.survival.MysteryLoot;
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
  private final Map<UUID, SurvivalItems.Payment> payments = new HashMap<>();
  private @Nullable ItemDisplay display;
  private @Nullable Cancellable animation;
  private int frame;
  private boolean revealed;
  private List<ItemStack> rewardBundle = List.of();

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
    if (!site.id().equals(active())) return "Dormant runic cache";
    return box.roll().isPresent() ? "Runic cache · reserved" : "ACTIVE · 16 emeralds · right-click";
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
      Texts.error(player, "Restore power at " + runner.map().powerDistrict() + " first.");
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
    var payment = runner.items().reserve(player, Map.of("EMERALD", 16));
    if (payment.isEmpty()) return true;
    payments.put(player.getUniqueId(), payment.orElseThrow());
    if (!box.start(player.getUniqueId(), reward(), runner.context().time().instant()))
      throw new IllegalStateException("Charged a busy runic cache");
    rewardBundle = bundle(box.roll().orElseThrow().reward());
    revealed = false;
    frame = 0;
    var at = Places.location(player.getWorld(), site().block().center()).add(0, 1.9, 0);
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
    Texts.info(player, "Runic cache rolling… right-click again to claim after the reveal.");
    return true;
  }

  private com.shepherdjerred.thestorm.arena.domain.survival.BoxReward reward() {
    var rarity = MysteryLoot.rarity(runner.context().random().nextInt(100));
    if (rarity.signature()) return signature(rarity);
    var materials =
        List.of(
            "IRON_SWORD",
            "IRON_AXE",
            "BOW",
            "CROSSBOW",
            "TRIDENT",
            "IRON_SPEAR",
            "SHIELD",
            "IRON_HELMET",
            "IRON_CHESTPLATE",
            "IRON_LEGGINGS",
            "IRON_BOOTS");
    return com.shepherdjerred.thestorm.arena.domain.survival.BoxReward.ordinary(
        materials.get(runner.context().random().nextInt(materials.size())), rarity);
  }

  private com.shepherdjerred.thestorm.arena.domain.survival.BoxReward signature(
      com.shepherdjerred.thestorm.arena.domain.survival.GearRarity rarity) {
    var rewards =
        runner.map().content().legendaries().stream()
            .filter(reward -> reward.id().rarity() == rarity)
            .toList();
    var pick =
        runner
            .context()
            .random()
            .nextInt(rewards.stream().mapToInt(SurvivalContent.LegendaryReward::weight).sum());
    for (var reward : rewards) {
      pick -= reward.weight();
      if (pick < 0)
        return com.shepherdjerred.thestorm.arena.domain.survival.BoxReward.signature(reward.id());
    }
    throw new IllegalStateException("Legendary weights did not resolve");
  }

  private List<ItemStack> bundle(
      com.shepherdjerred.thestorm.arena.domain.survival.BoxReward reward) {
    var weapon =
        reward
            .effect()
            .map(runner.items()::legendary)
            .orElseGet(() -> runner.items().stack(SurvivalItems.material(reward.material()), 1));
    runner.items().rarity(weapon, reward.rarity());
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
    if (!runner.items().deliver(player, rewardBundle)) {
      Texts.error(player, "Make room, then claim before the reveal expires.");
      return;
    }
    if (!box.claim(player.getUniqueId(), now))
      throw new IllegalStateException("Delivered an unclaimable box reward");
    runner.items().commit(java.util.Objects.requireNonNull(payments.remove(player.getUniqueId())));
    clearDisplay();
    runner.feedback().play(player, SurvivalFeedback.Cue.PURCHASE);
    Texts.info(player, "Runic cache reward: " + rewardName(roll.reward()));
    if (box.relocate(
        runner.context().random().nextInt(1, runner.map().content().boxSites().size()))) {
      beams();
      runner
          .online()
          .forEach(
              p ->
                  Texts.info(
                      p,
                      "The runic cache moved to "
                          + site().zone()
                          + ". Follow the magenta beacon; open its route if needed."));
    }
  }

  String landmark() {
    if (revealed) return "Cache reward · " + rewardName(box.roll().orElseThrow().reward());
    return "Runic cache · 16 emeralds";
  }

  private String rewardName(com.shepherdjerred.thestorm.arena.domain.survival.BoxReward reward) {
    return reward.rarity().name()
        + " · "
        + reward
            .effect()
            .map(
                id ->
                    runner.map().content().legendaries().stream()
                        .filter(r -> r.id() == id)
                        .findFirst()
                        .orElseThrow()
                        .name())
            .orElseGet(() -> SurvivalItems.name(SurvivalItems.material(reward.material())));
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
      item.setItemStack(rewardBundle.getFirst());
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
              refund(roll.owner());
              clearDisplay();
            });
  }

  private void refund(UUID id) {
    var payment = java.util.Objects.requireNonNull(payments.remove(id));
    var player = runner.context().server().getPlayer(id);
    runner.items().refund(runner.game().player(id).isPresent() ? player : null, payment);
    if (player != null) Texts.info(player, "Unclaimed box · 16 emeralds refunded.");
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
    revealed = false;
    rewardBundle = List.of();
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
              refund(id);
              clearDisplay();
            });
  }

  void reset() {
    clearDisplay();
    box.reset();
    if (runner.world().chunksReady()) beams();
    List.copyOf(payments.keySet()).forEach(this::refund);
  }
}

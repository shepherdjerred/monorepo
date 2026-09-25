package com.shepherdjerred.thestorm.spells.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.shepherdjerred.thestorm.spells.app.SpellScrolls;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemConsumeEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.potion.PotionEffectType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The spells module end to end on MockBukkit with a real SQLite store: enable, {@code /spells
 * bind}, casting a focus, paying reagents, cooldowns and the scroll port.
 */
final class SpellsModuleTest {

  @TempDir Path directory;

  private ServerMock server;
  private SpellsTestPlugin plugin;

  @BeforeEach
  void start() throws InterruptedException {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    SpellsTestPlugin.directory = directory;
    plugin =
        MockBukkit.loadWith(
            SpellsTestPlugin.class,
            new PluginDescriptionFile("TheStorm", "test", SpellsTestPlugin.class.getName()));
    // Let the stored state load (off the main thread) and open casting.
    settle();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private void settle() throws InterruptedException {
    for (var tick = 0; tick < 40; tick++) {
      server.getScheduler().performOneTick();
      Thread.sleep(5);
    }
  }

  private static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  private static List<String> said(PlayerMock player) {
    var lines = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      lines.add(plain(message));
    }
    return lines;
  }

  private PlayerMock spellcaster(int level) {
    var player = server.addPlayer();
    for (var tier = 1; tier <= level; tier++) {
      player.addAttachment(plugin, Track.SPELLCASTER.permission(tier), true);
    }
    return player;
  }

  private ItemStack focusIn(PlayerMock player) {
    return Arrays.stream(player.getInventory().getStorageContents())
        .filter(Objects::nonNull)
        .filter(item -> item.getType() == Material.PAPER)
        .findFirst()
        .orElseGet(() -> fail("no focus in %s's inventory", player.getName()));
  }

  private void rightClick(PlayerMock player, ItemStack item) {
    player.getInventory().setItemInMainHand(item);
    server
        .getPluginManager()
        .callEvent(
            new PlayerInteractEvent(
                player, Action.RIGHT_CLICK_AIR, item, null, BlockFace.SELF, EquipmentSlot.HAND));
  }

  @Test
  void aSpellcasterBindsAFocusForASpellTheyKnow() {
    var player = spellcaster(1);

    player.performCommand("spells bind haste");

    assertThat(said(player)).anyMatch(line -> line.contains("haste focus is ready"));
    var focus = focusIn(player);
    assertThat(plugin.services.require(SpellScrolls.class).spellOf(focus)).contains("haste");
  }

  @Test
  void aSpellAboveTheCastersTierCannotBeBound() {
    var player = spellcaster(1);

    player.performCommand("spells bind wall");

    assertThat(said(player)).anyMatch(line -> line.contains("You need Spellcaster II"));
    assertThat(player.getInventory().contains(Material.PAPER)).isFalse();
  }

  @Test
  void aQuestSpellNeedsLearning() {
    var player = spellcaster(3);

    player.performCommand("spells bind blink");
    assertThat(said(player)).anyMatch(line -> line.contains("not learned"));

    player.addAttachment(plugin, SpellScrolls.learnedPermission("blink"), true);
    player.performCommand("spells bind blink");
    assertThat(said(player)).anyMatch(line -> line.contains("blink focus is ready"));
  }

  @Test
  void rebindingLeavesOneFocusAndKillsTheOldOne() {
    var player = spellcaster(1);
    player.performCommand("spells bind haste");
    var first = focusIn(player).clone();
    player.performCommand("spells bind haste");
    said(player);

    var foci =
        Arrays.stream(player.getInventory().getStorageContents())
            .filter(Objects::nonNull)
            .filter(item -> item.getType() == Material.PAPER)
            .toList();
    assertThat(foci).hasSize(1);

    // A copy of the first focus (say, from a duplication glitch) crumbles when used.
    player.getInventory().addItem(ItemStack.of(Material.REDSTONE, 64));
    rightClick(player, first);
    assertThat(said(player)).anyMatch(line -> line.contains("faded"));
    assertThat(player.getInventory().getItemInMainHand().isEmpty()).isTrue();
    assertThat(player.hasPotionEffect(PotionEffectType.SPEED)).isFalse();
  }

  @Test
  void castingPaysReagentsAndStartsTheCooldown() {
    var player = spellcaster(1);
    player.performCommand("spells bind haste");
    var focus = focusIn(player);
    player.getInventory().setItem(20, ItemStack.of(Material.REDSTONE, 20));
    said(player);

    rightClick(player, focus);

    assertThat(player.hasPotionEffect(PotionEffectType.SPEED)).isTrue();
    assertThat(player.getInventory().getItem(20)).isEqualTo(ItemStack.of(Material.REDSTONE, 5));
    assertThat(player.getCooldown(focus)).isPositive();

    // The same click reported twice is silent; the cooldown still holds.
    rightClick(player, focus);
    assertThat(player.getInventory().getItem(20)).isEqualTo(ItemStack.of(Material.REDSTONE, 5));
  }

  @Test
  void withoutReagentsNothingHappens() {
    var player = spellcaster(1);
    player.performCommand("spells bind haste");
    said(player);

    rightClick(player, focusIn(player));

    assertThat(player.hasPotionEffect(PotionEffectType.SPEED)).isFalse();
    assertThat(said(player)).anyMatch(line -> line.contains("You need 15 redstone more"));
  }

  @Test
  void someoneElsesFocusDoesNotCast() {
    var owner = spellcaster(1);
    owner.performCommand("spells bind haste");
    var focus = focusIn(owner);
    var thief = spellcaster(5);
    thief.getInventory().addItem(ItemStack.of(Material.REDSTONE, 64));
    said(thief);

    rightClick(thief, focus);

    assertThat(thief.hasPotionEffect(PotionEffectType.SPEED)).isFalse();
    assertThat(said(thief)).anyMatch(line -> line.contains("bound to someone else"));
  }

  @Test
  void spellsListsWhatThePlayerCanUse() {
    var player = spellcaster(2);

    player.performCommand("spells");

    var lines = said(player);
    assertThat(lines).anyMatch(line -> line.contains("wall") && line.contains("Spellcaster II"));
    assertThat(lines).anyMatch(line -> line.contains("chainlightning"));
  }

  /** Another plugin that cancels every read after the spells module has prepared it. */
  static final class Veto implements Listener {
    @EventHandler(priority = EventPriority.HIGHEST)
    void veto(PlayerItemConsumeEvent event) {
      event.setCancelled(true);
    }
  }

  private PlayerItemConsumeEvent read(PlayerMock player, ItemStack scroll) {
    var event = new PlayerItemConsumeEvent(player, scroll, EquipmentSlot.HAND);
    server.getPluginManager().callEvent(event);
    return event;
  }

  private ItemStack scroll(String spell) {
    return plugin.services.require(SpellScrolls.class).scroll(spell, 1).orElseThrow();
  }

  @Test
  void aScrollIsConsumedOnlyWhenItsSpellGoesOff() {
    var reader = server.addPlayer();

    var first = read(reader, scroll("haste"));
    assertThat(first.isCancelled()).isFalse();
    assertThat(reader.hasPotionEffect(PotionEffectType.SPEED)).isTrue();

    // Haste is cooling down: the second read is refused and the scroll is kept.
    var second = read(reader, scroll("haste"));
    assertThat(second.isCancelled()).isTrue();
  }

  @Test
  void aScrollReadCancelledByAnotherPluginCastsNothing() {
    server.getPluginManager().registerEvents(new Veto(), plugin);
    var reader = server.addPlayer();

    read(reader, scroll("haste"));

    assertThat(reader.hasPotionEffect(PotionEffectType.SPEED)).isFalse();
  }

  @Test
  void aFocusIsNotAScroll() {
    var player = spellcaster(1);
    player.performCommand("spells bind haste");

    assertThat(read(player, focusIn(player)).isCancelled()).isTrue();
  }

  @Test
  void bindingIntoAFullInventoryIsRefusedBeforeAnythingIsRemoved() {
    var player = spellcaster(1);
    player.performCommand("spells bind haste");
    var focus = focusIn(player);
    // Move the focus to the ender chest and fill the backpack.
    player.getInventory().remove(focus);
    player.getEnderChest().addItem(focus);
    for (var slot = 0; slot < 36; slot++) {
      player.getInventory().setItem(slot, ItemStack.of(Material.DIRT, 64));
    }
    said(player);

    player.performCommand("spells bind haste");

    assertThat(said(player)).anyMatch(line -> line.contains("Make room"));
    assertThat(player.getEnderChest().contains(focus)).isTrue();
  }

  @Test
  void rebindingIntoAFullInventoryReusesTheOldFocusSlot() {
    var player = spellcaster(1);
    player.performCommand("spells bind haste");
    var old = focusIn(player);
    for (var slot = 0; slot < 36; slot++) {
      var item = player.getInventory().getItem(slot);
      if (item == null || item.isEmpty()) {
        player.getInventory().setItem(slot, ItemStack.of(Material.DIRT, 64));
      }
    }
    said(player);

    player.performCommand("spells bind haste");

    assertThat(said(player)).anyMatch(line -> line.contains("haste focus is ready"));
    assertThat(focusIn(player)).isNotEqualTo(old);
  }

  @Test
  void administratorsGiveScrolls() {
    var admin = server.addPlayer();
    admin.addAttachment(plugin, "thestorm.spells.admin", true);
    var reader = server.addPlayer();

    admin.performCommand("spells scroll carpet " + reader.getName() + " 3");

    var scroll = focusIn(reader);
    assertThat(scroll.getAmount()).isEqualTo(3);
    assertThat(plugin.services.require(SpellScrolls.class).spellOf(scroll)).contains("carpet");
  }
}

package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.rwf.app.FeatureGates;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitRotation;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.InventoryView;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The kit selector, menu and shop on MockBukkit: the lobby's nether star and red dye are given on
 * joining and after every pick; the star opens a read-only double chest of every kit in Red
 * Warfare's order, locked kits marked; a click picks an open kit through the same path as {@code
 * /rwf kit} and offers a locked one for sale; CONFIRM buys it with Red Warfare credits; the dye
 * leaves, and everything is gone once the match is live. With the kits flag off only the first four
 * kits are offered. Other chests stay closed to members.
 */
final class RwfKitMenuTest {

  /** Kits fill the menu from slot 0 in Red Warfare's order. */
  private static final int TROOPER = KitBook.ALL.indexOf(KitBook.TROOPER);

  private static final int LONGBOW = KitBook.ALL.indexOf(KitBook.LONGBOW);
  private static final int SELECTOR = 8;
  private static final int LEAVE = 7;
  private static final int MENU = 54;
  private static final int PURCHASE = 27;
  private static final int CONFIRM = 20;
  private static final int CANCEL = 24;

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  /** Every message read so far: reading a player's messages takes them. */
  private final List<String> heard = new ArrayList<>();

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfHarness start() {
    running = RwfHarness.start(directory);
    return running;
  }

  private static Material at(PlayerMock player, int slot) {
    return Optional.ofNullable(player.getInventory().getItem(slot))
        .map(ItemStack::getType)
        .orElse(Material.AIR);
  }

  private static void rightClick(RwfHarness harness, PlayerMock player, int slot) {
    player.getInventory().setHeldItemSlot(slot);
    var item = requireNonNull(player.getInventory().getItem(slot));
    harness
        .server
        .getPluginManager()
        .callEvent(
            new PlayerInteractEvent(player, Action.RIGHT_CLICK_AIR, item, null, BlockFace.SELF));
  }

  private static InventoryClickEvent click(
      RwfHarness harness, InventoryView view, ClickType type, int rawSlot) {
    var slotType =
        rawSlot < view.getTopInventory().getSize()
            ? InventoryType.SlotType.CONTAINER
            : InventoryType.SlotType.QUICKBAR;
    var event = new InventoryClickEvent(view, slotType, rawSlot, type, InventoryAction.PICKUP_ALL);
    harness.server.getPluginManager().callEvent(event);
    return event;
  }

  private static boolean open(PlayerMock player, int size) {
    var view = player.getOpenInventory();
    return view.getType() == InventoryType.CHEST && view.getTopInventory().getSize() == size;
  }

  private static boolean menuOpen(PlayerMock player) {
    return open(player, MENU);
  }

  /** Right-clicks the selector and waits for the menu, which opens once the kits have loaded. */
  private static InventoryView openMenu(RwfHarness harness, PlayerMock player) {
    rightClick(harness, player, SELECTOR);
    harness.until(() -> menuOpen(player));
    return player.getOpenInventory();
  }

  private static String name(ItemStack stack) {
    return PlainTextComponentSerializer.plainText()
        .serialize(requireNonNull(stack.getItemMeta().displayName()));
  }

  private static List<String> lore(ItemStack stack) {
    var lines = new ArrayList<String>();
    for (Component line : Optional.ofNullable(stack.lore()).orElseGet(List::of)) {
      lines.add(PlainTextComponentSerializer.plainText().serialize(line));
    }
    return lines;
  }

  /**
   * Whether {@code player} was told {@code text}. Tests wait on messages, not on the fake ledger:
   * polling its lock in a tight loop can starve the purchase that needs it.
   */
  private boolean said(PlayerMock player, String text) {
    heard.addAll(RwfHarness.messages(player));
    return heard.stream().anyMatch(message -> message.contains(text));
  }

  private static void fund(RwfHarness harness, PlayerMock player, long credits) {
    harness.wallets.hold(
        new AccountId.Player(player.getUniqueId()), Money.of(CurrencyId.RWF_CREDITS, credits));
  }

  private static long credits(RwfHarness harness, PlayerMock player) {
    return harness
        .wallets
        .held(new AccountId.Player(player.getUniqueId()), CurrencyId.RWF_CREDITS)
        .amount();
  }

  /** A bought kit that is not free in the harness clock's week. */
  private static KitSpec lockedThisWeek() {
    var free = KitRotation.of(KitRotation.Week.of(Samples.T0), KitBook.ALL);
    return KitBook.ALL.stream()
        .filter(kit -> kit.purchasable() && !free.contains(kit))
        .findFirst()
        .orElseThrow();
  }

  @Test
  void joiningAndPickingKeepTheSelectorAndTheLeaveItemInTheHotbar() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);

    assertThat(at(alice, SELECTOR)).isEqualTo(Material.NETHER_STAR);
    assertThat(at(alice, LEAVE)).isEqualTo(Material.RED_DYE);
    assertThat(name(requireNonNull(alice.getInventory().getItem(SELECTOR))))
        .isEqualTo("Choose kit");

    alice.performCommand("rwf kit longbow");

    assertThat(at(alice, 2)).isEqualTo(Material.BOW);
    assertThat(at(alice, 9))
        .as("the arrow sits where Red Warfare put it")
        .isEqualTo(Material.ARROW);
    assertThat(at(alice, SELECTOR)).isEqualTo(Material.NETHER_STAR);
    assertThat(at(alice, LEAVE)).isEqualTo(Material.RED_DYE);
  }

  @Test
  void theSelectorOpensAMenuOfEveryKitInRedWarfaresOrder() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    alice.performCommand("rwf kit shortbow");

    var top = openMenu(harness, alice).getTopInventory();

    var icons = new ArrayList<ItemStack>();
    for (var slot = 0; slot < KitBook.ALL.size(); slot++) {
      icons.add(requireNonNull(top.getItem(slot)));
    }
    assertThat(icons)
        .extracting(RwfKitMenuTest::name)
        .containsExactlyElementsOf(KitBook.ALL.stream().map(KitSpec::name).toList());
    assertThat(icons.get(KitBook.ALL.indexOf(KitBook.SHORTBOW)).getType())
        .as("Shortbow's icon is a bow, as Red Warfare showed it")
        .isEqualTo(Material.BOW);
    assertThat(icons)
        .as("Red Warfare marked no kit as picked")
        .noneMatch(icon -> icon.getItemMeta().hasEnchantmentGlintOverride());
    var locked = lockedThisWeek();
    assertThat(lore(icons.get(KitBook.ALL.indexOf(locked))))
        .as("Red Warfare's LORE layout breaks the price line before 'credits'")
        .containsSubsequence(
            "LOCKED Purchase for " + locked.price(), "credits", "Click to purchase");
    assertThat(lore(icons.get(TROOPER))).contains("Basic kit, always free");
    assertThat(lore(icons.get(TROOPER)))
        .as("the description, in Red Warfare's wording")
        .anyMatch(line -> line.startsWith("The kit that sets the"));
    assertThat(requireNonNull(top.getItem(48)).getType()).isEqualTo(Material.EMERALD);
    assertThat(requireNonNull(top.getItem(50)).getType()).isEqualTo(Material.CLOCK);
    assertThat(top.getItem(53)).as("one page holds every kit").isNull();
  }

  @Test
  void thisWeeksFreeKitsAreMarkedAndOpenWithoutBuying() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    var free = KitRotation.of(KitRotation.Week.of(Samples.T0), KitBook.ALL);

    var top = openMenu(harness, alice).getTopInventory();

    assertThat(free).hasSize(KitRotation.SIZE);
    for (var kit : free) {
      assertThat(lore(requireNonNull(top.getItem(KitBook.ALL.indexOf(kit)))))
          .contains("FREE THIS WEEK");
    }
    assertThat(lore(requireNonNull(top.getItem(50))))
        .containsAll(
            free.stream().map(kit -> kit.name() + " (" + kit.tier().displayName() + ")").toList());
    alice.closeInventory();
    alice.performCommand("rwf kit " + free.getFirst().id());
    assertThat(harness.combatant(alice).kit()).contains(free.getFirst().id());
  }

  @Test
  void clickingLongbowPicksItKeepsTheSelectorAndClosesTheMenu() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    var view = openMenu(harness, alice);

    var click = click(harness, view, ClickType.LEFT, LONGBOW);

    assertThat(click.isCancelled()).isTrue();
    assertThat(harness.combatant(alice).kit()).contains("longbow");
    assertThat(at(alice, 2)).isEqualTo(Material.BOW);
    assertThat(at(alice, SELECTOR)).isEqualTo(Material.NETHER_STAR);
    harness.ticks(2);
    assertThat(menuOpen(alice)).isFalse();
  }

  @Test
  void clickingALockedKitOffersItAndConfirmBuysItWithCredits() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    var kit = lockedThisWeek();
    fund(harness, alice, kit.price() + 7);
    alice.performCommand("rwf kit " + kit.id());
    assertThat(harness.combatant(alice).kit()).as("not bought yet").isEmpty();
    var view = openMenu(harness, alice);

    click(harness, view, ClickType.LEFT, KitBook.ALL.indexOf(kit));
    harness.until(() -> open(alice, PURCHASE));
    var confirm = alice.getOpenInventory();
    assertThat(lore(requireNonNull(confirm.getTopInventory().getItem(4))))
        .containsExactly("Price: " + kit.price() + " credits");
    assertThat(name(requireNonNull(confirm.getTopInventory().getItem(CONFIRM))))
        .isEqualTo("CONFIRM");
    click(harness, confirm, ClickType.LEFT, CONFIRM);

    harness.until(() -> said(alice, "Purchased kit " + kit.name() + " for " + kit.price()));
    harness.until(() -> menuOpen(alice));
    assertThat(credits(harness, alice)).isEqualTo(7);
    alice.performCommand("rwf kit " + kit.id());
    assertThat(harness.combatant(alice).kit()).contains(kit.id());
  }

  @Test
  void cancellingAPurchaseGoesBackToTheMenuAndChargesNothing() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    fund(harness, alice, 1000);
    var view = openMenu(harness, alice);

    click(harness, view, ClickType.LEFT, KitBook.ALL.indexOf(lockedThisWeek()));
    harness.until(() -> open(alice, PURCHASE));
    click(harness, alice.getOpenInventory(), ClickType.LEFT, CANCEL);
    harness.until(() -> menuOpen(alice));

    assertThat(credits(harness, alice)).isEqualTo(1000);
  }

  @Test
  void tooFewCreditsBuysNothing() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    var kit = lockedThisWeek();
    fund(harness, alice, 10);

    alice.performCommand("rwf buy " + kit.id());

    harness.until(() -> said(alice, "Required: " + kit.price() + " credits. You have: 10 credits"));
    assertThat(credits(harness, alice)).isEqualTo(10);
    alice.performCommand("rwf kit " + kit.id());
    assertThat(harness.combatant(alice).kit()).isEmpty();
  }

  @Test
  void buyingByCommandOwnsTheKitForGood() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    var kit = lockedThisWeek();
    fund(harness, alice, kit.price());

    alice.performCommand("rwf buy " + kit.id());
    harness.until(() -> said(alice, "Purchased kit " + kit.name()));
    assertThat(credits(harness, alice)).isZero();
    alice.performCommand("rwf buy " + kit.id());
    harness.until(() -> said(alice, "already own"));

    assertThat(credits(harness, alice)).as("owned kits are never charged twice").isZero();
    alice.performCommand("rwf kit " + kit.id());
    assertThat(harness.combatant(alice).kit()).contains(kit.id());
  }

  @Test
  void rotationAndCreditsAreOneCommandAway() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    fund(harness, alice, 42);
    var free = KitRotation.of(KitRotation.Week.of(Samples.T0), KitBook.ALL);

    alice.performCommand("rwf rotation");
    alice.performCommand("rwf credits");
    harness.until(() -> said(alice, "You have 42 credits"));

    assertThat(heard)
        .anyMatch(
            m ->
                m.contains("Free this week: ")
                    && free.stream().allMatch(kit -> m.contains(kit.name())));
  }

  @Test
  void theRotationWallShowsThisWeeksFreeKitsInItsSlots() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    var free = KitRotation.of(KitRotation.Week.of(Samples.T0), KitBook.ALL);
    var tag = new org.bukkit.NamespacedKey("thestorm", "rwf_lobby");

    harness.until(
        () ->
            harness.lobbyWorld.getEntitiesByClass(org.bukkit.entity.ItemDisplay.class).stream()
                .anyMatch(
                    display ->
                        "rotation-item:1"
                            .equals(
                                display
                                    .getPersistentDataContainer()
                                    .get(tag, org.bukkit.persistence.PersistentDataType.STRING))));

    // The fixture's wall has two slots: the first two free kits fill them, in order.
    for (var slot = 1; slot <= 2; slot++) {
      var part = "rotation-label:" + slot;
      var kit = free.get(slot - 1);
      assertThat(harness.lobbyWorld.getEntitiesByClass(org.bukkit.entity.TextDisplay.class))
          .filteredOn(
              display ->
                  part.equals(
                      display
                          .getPersistentDataContainer()
                          .get(tag, org.bukkit.persistence.PersistentDataType.STRING)))
          .singleElement()
          .satisfies(
              display ->
                  assertThat(PlainTextComponentSerializer.plainText().serialize(display.text()))
                      .isEqualTo(kit.name()));
    }
  }

  @Test
  void withTheKitsFlagOffOnlyTheFirstFourKitsAreOffered() {
    var harness = RwfHarness.prepare(directory);
    JoinGate closed = player -> CompletableFuture.completedFuture(false);
    harness.kitGates = new FeatureGates(closed, JoinGate.open());
    running = harness.enable(directory);
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    fund(harness, alice, 1000);

    var top = openMenu(harness, alice).getTopInventory();

    assertThat(List.of(top.getItem(0), top.getItem(1), top.getItem(2), top.getItem(3)))
        .extracting(stack -> name(requireNonNull(stack)))
        .containsExactly("Trooper", "Longbow", "Shortbow", "Rewind");
    assertThat(top.getItem(4)).isNull();
    alice.closeInventory();
    alice.performCommand("rwf kit berserker");
    alice.performCommand("rwf buy berserker");
    harness.until(() -> said(alice, "shop is not open"));
    assertThat(harness.combatant(alice).kit()).isEmpty();
    assertThat(credits(harness, alice)).isEqualTo(1000);
  }

  @Test
  void nothingCanBeTakenFromOrMovedIntoTheMenu() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    var view = openMenu(harness, alice);

    // An empty slot of the chest, then the player's own hotbar below it: raw slot 54 + 27 + 8
    // is the selector.
    assertThat(click(harness, view, ClickType.SHIFT_LEFT, 40).isCancelled()).isTrue();
    assertThat(click(harness, view, ClickType.LEFT, 89).isCancelled()).isTrue();
    var drag =
        new InventoryDragEvent(
            view,
            null,
            ItemStack.of(Material.STONE),
            false,
            Map.of(TROOPER, ItemStack.of(Material.STONE)));
    harness.server.getPluginManager().callEvent(drag);
    assertThat(drag.isCancelled()).isTrue();
    assertThat(view.getTopInventory().getItem(TROOPER)).isNotNull();
    assertThat(requireNonNull(view.getTopInventory().getItem(TROOPER)).getType())
        .isEqualTo(Material.IRON_SWORD);
    assertThat(harness.combatant(alice).kit()).isEmpty();
    assertThat(at(alice, SELECTOR)).isEqualTo(Material.NETHER_STAR);

    // Even a shift-click on an icon only picks the kit; the icon stays in the menu.
    assertThat(click(harness, view, ClickType.SHIFT_LEFT, TROOPER).isCancelled()).isTrue();
    assertThat(requireNonNull(view.getTopInventory().getItem(TROOPER)).getType())
        .isEqualTo(Material.IRON_SWORD);
    assertThat(harness.combatant(alice).kit()).contains("trooper");
  }

  @Test
  void otherChestsStayClosedToMembers() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);

    alice.openInventory(harness.server.createInventory(null, 27));

    assertThat(open(alice, 27)).isFalse();
  }

  @Test
  void goingLiveClosesTheMenuAndTakesTheLobbyItemsAway() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    openMenu(harness, alice);

    harness.goLive(alice);

    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
    assertThat(menuOpen(alice)).isFalse();
    assertThat(alice.getInventory().contains(Material.NETHER_STAR)).isFalse();
    assertThat(alice.getInventory().contains(Material.RED_DYE)).isFalse();
    assertThat(at(alice, 0)).isEqualTo(Material.BLAZE_POWDER);
  }

  @Test
  void theLeaveItemLeavesTheMatch() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);

    rightClick(harness, alice, LEAVE);

    assertThat(harness.inMatch(alice)).isFalse();
    assertThat(alice.getWorld()).isEqualTo(harness.overworld);
    assertThat(alice.getInventory().contains(Material.RED_DYE)).isFalse();
    assertThat(alice.getInventory().contains(Material.DIAMOND, 5)).isTrue();
  }
}

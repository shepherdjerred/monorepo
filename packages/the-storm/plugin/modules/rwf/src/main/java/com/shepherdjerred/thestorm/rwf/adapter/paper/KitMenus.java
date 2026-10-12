// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/kits/KitInventory.java and
// KitPurchaseInventory.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.app.shop.Purchase;
import com.shepherdjerred.thestorm.rwf.app.shop.ShopError;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.Optional;
import java.util.function.Consumer;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

/**
 * Opens the kit menu and the purchase confirmation, and carries out purchases with Red Warfare's
 * messages and sounds. Main thread only.
 */
final class KitMenus {

  private final PaperContext context;
  private final KitFactory items;
  private final Armory armory;
  private final KitMenu.Opener opener;
  private final RwfAnalytics product;

  KitMenus(PaperContext context, KitFactory items, Armory armory, RwfAnalytics product) {
    this.context = context;
    this.items = items;
    this.armory = armory;
    this.product = product;
    this.opener = new KitMenu.Opener(context.server(), items);
  }

  Armory armory() {
    return armory;
  }

  /** Opens page {@code page} of the kit menu for {@code player}, marking {@code picked}. */
  void open(Player player, Optional<String> picked, int page) {
    var id = player.getUniqueId();
    armory.load(
        id,
        () -> {
          if (!player.isOnline()) {
            return;
          }
          var now = context.time().instant();
          var access = armory.access(id).orElseThrow();
          var view =
              new KitMenu.View(
                  access.expanded() ? armory.kits() : KitBook.MILESTONE_ONE,
                  access,
                  picked,
                  armory.rotation(now),
                  KitMenu.until(now, armory.rotationEnds(now)),
                  Optional.empty(),
                  page);
          var menu = opener.open(player, view);
          armory.credits(
              id,
              credits -> {
                if (player.getOpenInventory().getTopInventory().getHolder() == menu) {
                  menu.showCredits(credits);
                }
              });
        });
  }

  /** Opens the purchase confirmation for {@code kit}. */
  void confirm(Player player, KitSpec kit) {
    KitPurchaseMenu.open(context.server(), items, player, kit);
  }

  /** Opens the layout editor for {@code kit}, laid out as {@code player} last saved it. */
  void editLayout(Player player, KitSpec kit) {
    var _ =
        KitLayoutMenu.open(
            context.server(),
            items,
            player,
            new KitLayoutMenu.Layout(kit, armory.layout(player.getUniqueId(), kit.id())));
  }

  /**
   * {@code player} buys {@code kit}; Red Warfare's messages and sounds follow, and {@code after}
   * runs once it is settled, bought or not.
   */
  void buy(Player player, KitSpec kit, Consumer<Boolean> after) {
    var id = player.getUniqueId();
    armory.load(
        id,
        () -> {
          if (!armory.expanded(id)) {
            Texts.error(player, "The kit shop is not open to you yet.");
            after.accept(false);
            return;
          }
          armory.buy(
              id,
              kit,
              result -> {
                if (result instanceof Result.Ok<Purchase, ShopError>) {
                  product.kitPurchased(new CombatantId.Human(id), kit.id(), kit.price());
                }
                after.accept(report(player, kit, result));
              });
        });
  }

  /** Tells {@code player} how the purchase went; whether they own the kit now. */
  private static boolean report(Player player, KitSpec kit, Result<Purchase, ShopError> result) {
    return switch (result) {
      case Result.Ok<Purchase, ShopError> _ -> {
        Texts.success(player, "Purchased kit " + kit.name() + " for " + kit.price() + " credits!");
        player.playSound(Places.at(player), Sound.BLOCK_NOTE_BLOCK_PLING, 1, 2);
        yield true;
      }
      case Result.Err<Purchase, ShopError>(ShopError.TooPoor(var price, var balance)) -> {
        Texts.error(player, "Required: " + price + " credits. You have: " + balance + " credits.");
        player.playSound(Places.at(player), Sound.BLOCK_NOTE_BLOCK_HARP, 1, 0);
        yield false;
      }
      case Result.Err<Purchase, ShopError>(ShopError.AlreadyOwned _) -> {
        Texts.info(player, "You already own " + kit.name() + ".");
        yield true;
      }
      case Result.Err<Purchase, ShopError>(ShopError.NotForSale _) -> {
        Texts.error(player, kit.name() + " is not for sale.");
        yield false;
      }
      case Result.Err<Purchase, ShopError>(ShopError.InProgress _) -> {
        Texts.error(player, "Your purchase of " + kit.name() + " is still being completed.");
        yield false;
      }
    };
  }
}

package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.shops.adapter.content.CatalogDirectory;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.bukkit.Material;
import org.junit.jupiter.api.Test;

/** The shipped catalogs against the game's item registry, the published port, and /shop. */
final class CatalogsAndCommandTest extends ShopsFixture {

  private static final Path SHIPPED = ShopsTestPlugin.OWNED.resolve("shops");

  @Test
  void theShippedCatalogsNameRealItemsAndNeverLoop() {
    var catalogs = CatalogDirectory.load(SHIPPED, ShopsPaper::isItem);

    assertThat(catalogs)
        .extracting(Catalog::id)
        .containsExactly(
            "baker",
            "blacksmith",
            "braxtons-exchange",
            "florist",
            "justys-supplies",
            "reynolds-supplies");
  }

  @Test
  void theTradeGoodsBuyerBuysEmeraldsAndSellsNothing() {
    var exchange =
        CatalogDirectory.load(SHIPPED, ShopsPaper::isItem).stream()
            .filter(catalog -> catalog.id().equals("braxtons-exchange"))
            .findFirst()
            .orElseThrow();

    assertThat(exchange.entry("emerald"))
        .hasValueSatisfying(entry -> assertThat(entry.sell()).isPresent());
    assertThat(exchange.entries()).allSatisfy(entry -> assertThat(entry.buy()).isEmpty());
  }

  @Test
  void aBrokenCatalogStopsTheModuleWithEveryProblem() throws Exception {
    var directory = Files.createDirectories(this.directory.resolve("broken"));
    Files.writeString(
        directory.resolve("baker.yml"),
        """
        id: bakery
        name: Bakery
        greeting: Hi
        entries:
          - item: unobtainium
            quantity: 1
            buy: 5
            sell: null
            dailyLimit: null
        """);
    Files.writeString(directory.resolve("florist.yml"), "id: florist\n");
    Files.writeString(directory.resolve("notes.txt"), "not a catalog");

    assertThatThrownBy(() -> CatalogDirectory.load(directory, ShopsPaper::isItem))
        .hasMessageContaining("florist.yml")
        .hasMessageContaining("name");

    Files.delete(directory.resolve("florist.yml"));
    assertThatThrownBy(() -> CatalogDirectory.load(directory, ShopsPaper::isItem))
        .hasMessageContaining("baker.yml must be named bakery.yml")
        .hasMessageContaining("unobtainium, which is not an item");
  }

  @Test
  void anEmptyOrMissingDirectoryIsAnError() throws Exception {
    var empty = Files.createDirectories(directory.resolve("empty"));

    assertThatThrownBy(() -> CatalogDirectory.load(empty, ShopsPaper::isItem))
        .hasMessageContaining("No catalogs");
    assertThatThrownBy(() -> CatalogDirectory.load(directory.resolve("nope"), ShopsPaper::isItem))
        .hasMessageContaining("could not be read");
  }

  @Test
  void theModulePublishesTheNpcShops() {
    var shops = plugin.services.require(ServerShops.class);

    assertThat(shops.has("baker")).isTrue();
    assertThat(shops.has("nowhere")).isFalse();
    assertThat(shops.catalogIds()).contains("reynolds-supplies", "braxtons-exchange");
    assertThatThrownBy(() -> shops.open(player("Bob", 0), "nowhere"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void shopShowsYourShopsAgainstYourLimit() {
    var alice = player("Alice", 2);
    shop(alice, chest(0), "", "1", "B 5", "coal");
    var bob = player("Bob", 0);
    messages(alice);

    assertThat(server.dispatchCommand(alice, "shop")).isTrue();
    assertThat(server.dispatchCommand(bob, "shop")).isTrue();

    assertThat(messages(alice))
        .containsExactly("[Shop]: You own 1 of the 10 chest shops Shopkeeper 2 allows.");
    assertThat(messages(bob))
        .containsExactly("[Shop]: You own 0 chest shops. Train as a Shopkeeper to open your own.");
  }

  @Test
  void onlyAdminsOpenCatalogsByCommand() {
    var root = admin("Root");
    var bob = player("Bob", 0);

    server.dispatchCommand(root, "shop nowhere");
    server.dispatchCommand(bob, "shop baker");

    assertThat(messages(root))
        .singleElement()
        .asString()
        .startsWith("[Shop]: No shop called nowhere. Shops: baker, blacksmith,");
    assertThat(messages(bob)).noneMatch(line -> line.startsWith("[Shop]:"));
  }

  @Test
  void containersMustBeBlocks() {
    assertThat(ShopsPaper.containers(java.util.List.of("CHEST", "BARREL")))
        .isEqualTo(Set.of(Material.CHEST, Material.BARREL));
    assertThatThrownBy(() -> ShopsPaper.containers(java.util.List.of("CHEST", "DIAMOND", "NOPE")))
        .hasMessageContaining("[DIAMOND, NOPE]");
  }
}

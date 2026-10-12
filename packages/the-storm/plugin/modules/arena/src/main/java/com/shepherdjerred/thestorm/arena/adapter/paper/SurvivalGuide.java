package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.meta.BookMeta;

/** Public rules remain available on demand; exploration rewards and loot odds stay undisclosed. */
final class SurvivalGuide {
  private final SurvivalRunner runner;

  SurvivalGuide(SurvivalRunner runner) {
    this.runner = runner;
  }

  private org.bukkit.inventory.ItemStack book() {
    var book = runner.items().stack(Material.WRITTEN_BOOK, 1);
    var entries =
        com.shepherdjerred.thestorm.arena.domain.survival.SurvivalTutorials.catalog()
            .tips()
            .stream()
            .map(
                tip ->
                    new Chapter(title(tip.key()), paginate(title(tip.key()) + "\n\n" + tip.text())))
            .toList();
    var pages = new ArrayList<Component>();
    var indexPages = Math.ceilDiv(entries.size(), 7);
    var destination = indexPages + 1;
    for (var start = 0; start < entries.size(); start += 7) {
      var index = Component.text("Survivor's handbook\nClick a topic to read\n\n");
      for (var chapter : entries.subList(start, Math.min(start + 7, entries.size()))) {
        index =
            index.append(
                Component.text(
                        chapter.title() + "\n",
                        net.kyori.adventure.text.format.NamedTextColor.DARK_BLUE)
                    .clickEvent(net.kyori.adventure.text.event.ClickEvent.changePage(destination)));
        destination += chapter.pages().size();
      }
      pages.add(index);
    }
    entries.forEach(chapter -> pages.addAll(chapter.pages()));
    if (pages.size() > 100)
      throw new IllegalStateException("Survivor handbook exceeds native book capacity");
    book.editMeta(
        meta -> {
          var written = (BookMeta) meta;
          written.title(Component.text("Survivor's handbook"));
          written.author(Component.text("The Storm"));
          written.pages(pages);
        });
    return book;
  }

  private record Chapter(String title, List<Component> pages) {}

  private static String title(com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey key) {
    var raw = key.variant().isEmpty() ? key.topic().name() : key.variant();
    return raw.toLowerCase(java.util.Locale.ROOT).replace('_', ' ').replace('-', ' ');
  }

  private static List<Component> paginate(String text) {
    var pages = new ArrayList<Component>();
    var page = new StringBuilder();
    for (var word : com.google.common.base.Splitter.on(' ').split(text)) {
      if (page.length() + word.length() > 210) {
        pages.add(Component.text(page.toString()));
        page.setLength(0);
      }
      if (!page.isEmpty()) page.append(' ');
      page.append(word);
    }
    if (!page.isEmpty()) pages.add(Component.text(page.toString()));
    return pages;
  }

  void prepare() {
    if (!(runner.world().block(runner.map().content().lobbyGuide()).getState()
        instanceof org.bukkit.block.Lectern lectern))
      throw new IllegalStateException("Authored lobby lectern missing");
    lectern.getInventory().setItem(0, book());
  }

  void open(Player player) {
    player.openBook(book());
  }
}

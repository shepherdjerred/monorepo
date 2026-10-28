package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.block.Sign;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.player.PlayerEditBookEvent;
import org.bukkit.inventory.meta.BookMeta;

/** Edit cancellation preserves the old content until the exact new version has been approved. */
public final class WrittenContentGate implements Listener {
  private final ModuleContext context;
  private final ContentAdmission admission;
  private final Set<Event> replay = Collections.newSetFromMap(new IdentityHashMap<>());

  public WrittenContentGate(ModuleContext context, ContentSafety safety) {
    this.context = context;
    admission = new ContentAdmission(context, safety);
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  public void sign(SignChangeEvent event) {
    if (replay.remove(event)) return;
    event.setCancelled(true);
    var player = event.getPlayer();
    var block = event.getBlock();
    if (!(block.getState() instanceof Sign before)) return;
    var side = event.getSide();
    var original = before.getSide(side).lines();
    var originalType = before.getBlockData();
    var lines = java.util.List.copyOf(event.lines());
    var text =
        event.lines().stream()
            .map(PlainTextComponentSerializer.plainText()::serialize)
            .reduce("", (all, line) -> all + "\n" + line);
    var serialized =
        event.lines().stream()
            .map(GsonComponentSerializer.gson()::serialize)
            .reduce("", (all, line) -> all + "\n" + line);
    var submission =
        admission.submission(
            player,
            new ContentAdmission.Draft(
                "sign", "public", text, serialized, block.getLocation() + " side=" + side));
    admission.publish(
        player,
        submission,
        () -> {
          if (!(block.getState() instanceof Sign current)
              || !current.getBlockData().equals(originalType)
              || current.isWaxed()
              || !block.getWorld().equals(player.getWorld())
              || block.getLocation().distanceSquared(player.getLocation()) > 64
              || !current.getSide(side).lines().equals(original)) return "stale-edit";
          var approved = new SignChangeEvent(block, player, new java.util.ArrayList<>(lines), side);
          replay.add(approved);
          try {
            context.plugin().getServer().getPluginManager().callEvent(approved);
          } finally {
            replay.remove(approved);
          }
          if (approved.isCancelled()) return "denied-by-sign-protection";
          if (!(block.getState() instanceof Sign after)) return "stale-edit";
          for (var index = 0; index < 4; index++)
            after.getSide(side).line(index, approved.line(index));
          return after.update(false, false) ? "sign-published" : "stale-edit";
        });
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  public void book(PlayerEditBookEvent event) {
    if (replay.remove(event)) return;
    event.setCancelled(true);
    var player = event.getPlayer();
    var proposed = event.getNewBookMeta();
    var text =
        proposed.pages().stream()
            .map(PlainTextComponentSerializer.plainText()::serialize)
            .reduce(
                proposed.getTitle() == null ? "" : proposed.getTitle(),
                (all, page) -> all + "\n" + page);
    var components = proposed.getAsString();
    var slot = bookSlot(player, event.getPreviousBookMeta());
    var submission =
        admission.submission(
            player,
            new ContentAdmission.Draft("book", "readers", text, components, "inventory:" + slot));
    if (slot < 0) {
      admission.observe(submission, "ambiguous-book-slot");
      player.sendMessage(
          net.kyori.adventure.text.Component.text(
              "Book edit saved but not applied. Keep only one matching editable book in your hotbar and hands, then retry. Reference "
                  + submission.id()));
      return;
    }
    var original = player.getInventory().getItem(slot).clone();
    var capturedSlot = slot;
    admission.publish(
        player,
        submission,
        () -> {
          if (!original.equals(player.getInventory().getItem(capturedSlot))) return "stale-edit";
          var approved =
              new PlayerEditBookEvent(
                  player, capturedSlot, event.getPreviousBookMeta(), proposed, event.isSigning());
          replay.add(approved);
          try {
            context.plugin().getServer().getPluginManager().callEvent(approved);
          } finally {
            replay.remove(approved);
          }
          if (approved.isCancelled()) return "denied-by-book-listener";
          if (!original.equals(player.getInventory().getItem(capturedSlot))) return "stale-edit";
          var replacement =
              approved.isSigning() ? original.withType(Material.WRITTEN_BOOK) : original.clone();
          BookMeta approvedMeta = approved.getNewBookMeta();
          replacement.setItemMeta(approvedMeta);
          player.getInventory().setItem(capturedSlot, replacement);
          return "book-published";
        });
  }

  private static int bookSlot(org.bukkit.entity.Player player, BookMeta previous) {
    // getSlot is deprecated for removal without a hand replacement. Never guess between
    // identical books: locate a unique matching item, including the offhand slot.
    var matches =
        java.util.stream.IntStream.concat(
                java.util.stream.IntStream.range(0, 9), java.util.stream.IntStream.of(40))
            .filter(
                slot -> {
                  var item = player.getInventory().getItem(slot);
                  return item != null
                      && item.getType() == Material.WRITABLE_BOOK
                      && java.util.Objects.equals(item.getItemMeta(), previous);
                })
            .toArray();
    return matches.length == 1 ? matches[0] : -1;
  }
}

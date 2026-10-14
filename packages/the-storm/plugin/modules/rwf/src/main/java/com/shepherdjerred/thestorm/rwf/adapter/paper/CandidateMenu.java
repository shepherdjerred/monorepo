package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;

/** Immutable ballot view; delayed clicks carry the generation and recheck current membership. */
final class CandidateMenu implements InventoryHolder {
  static final int SIZE = 45;
  static final int RETURN = 39;
  static final int KITS = 41;
  private final Inventory inventory;
  private final int generation;
  private final int membership;
  private final List<String> maps;

  record Request(int generation, int membership, Ballot ballot, List<MapWorld> candidates) {}

  CandidateMenu(Server server, Request request) {
    var generation = request.generation();
    var ballot = request.ballot();
    var candidates = request.candidates();
    this.generation = generation;
    this.membership = request.membership();
    maps = ballot.candidates().stream().map(Ballot.Candidate::mapId).toList();
    inventory =
        server.createInventory(
            this, SIZE, Component.text("Visit maps and vote", NamedTextColor.DARK_BLUE));
    for (var index = 0; index < maps.size(); index++) {
      var mapId = maps.get(index);
      var map =
          candidates.stream()
              .filter(candidate -> candidate.id().equals(mapId))
              .findFirst()
              .orElseThrow();
      var definition = map.definition();
      var column = 10 + index * 3;
      var lore = new ArrayList<>(wrap(definition.description()));
      lore.add("by " + definition.author());
      lore.add(ballot.count(mapId) + " votes");
      inventory.setItem(column, item(Material.PAPER, definition.name(), lore));
      inventory.setItem(
          column + 9,
          item(
              Material.FEATHER,
              "Visit " + definition.name(),
              List.of(
                  map.visitReady()
                      ? "Fly freely; you cannot take damage"
                      : "Terrain is still preparing",
                  "Visit independently of other players")));
      inventory.setItem(
          column + 18,
          item(
              Material.LODESTONE,
              "Vote for " + definition.name(),
              List.of(
                  ballot.closed() ? "Voting has closed" : "Click to cast or change your vote")));
    }
    inventory.setItem(
        RETURN, item(Material.OAK_DOOR, "Return to lobby", List.of("Keep your kit and vote")));
    inventory.setItem(
        KITS, item(Material.NETHER_STAR, "Choose kit", List.of("Browse kits while visiting")));
  }

  int generation() {
    return generation;
  }

  int membership() {
    return membership;
  }

  List<String> maps() {
    return maps;
  }

  static ItemStack item(Material material, String title, List<String> lore) {
    var stack = ItemStack.of(material);
    stack.editMeta(
        meta -> {
          meta.displayName(
              Component.text(title, NamedTextColor.GOLD).decoration(TextDecoration.ITALIC, false));
          meta.lore(
              lore.stream()
                  .map(
                      line ->
                          Component.text(line, NamedTextColor.GRAY)
                              .decoration(TextDecoration.ITALIC, false))
                  .map(Component.class::cast)
                  .toList());
        });
    return stack;
  }

  static List<String> wrap(String description) {
    var lines = new ArrayList<String>();
    var line = new StringBuilder();
    for (var word : Pattern.compile("\\s+").splitAsStream(description).toList()) {
      if (!line.isEmpty() && line.length() + word.length() + 1 > 42) {
        lines.add(line.toString());
        line.setLength(0);
      }
      if (!line.isEmpty()) line.append(' ');
      line.append(word);
    }
    if (!line.isEmpty()) lines.add(line.toString());
    return List.copyOf(lines);
  }

  @Override
  public Inventory getInventory() {
    return inventory;
  }
}

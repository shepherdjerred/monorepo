package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mechanics.domain.sign.SignTags;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.jspecify.annotations.Nullable;

/** Binds surveyed lift signs to proven shop owners when first used. */
final class HistoricalLifts {
  record Position(String world, int x, int y, int z) {}

  record Entry(UUID owner, String tag, String fourthLine, String thirdLine) {}

  private volatile @Nullable Map<Position, Entry> catalog;
  private final Signs signs;
  private final Protection protection;

  HistoricalLifts(
      CompletableFuture<Map<Position, Entry>> catalog, Signs signs, Protection protection) {
    this.signs = signs;
    this.protection = protection;
    var _ = catalog.thenAccept(loaded -> this.catalog = Map.copyOf(loaded));
  }

  static Map<Position, Entry> load() {
    var stream =
        Objects.requireNonNull(HistoricalLifts.class.getResourceAsStream("/historical-lifts.csv"));
    try (var reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
      return read(reader);
    } catch (IOException error) {
      throw new UncheckedIOException("cannot read historical lifts", error);
    }
  }

  static Map<Position, Entry> read(BufferedReader reader) throws IOException {
    var result = new HashMap<Position, Entry>();
    String line;
    while ((line = reader.readLine()) != null) {
      if (line.isBlank() || line.startsWith("#")) continue;
      var f = line.split(",", -1);
      if ((f.length < 6 || f.length > 8) || f[0].isBlank())
        throw new IllegalArgumentException("invalid historical lift row");
      var pos =
          new Position(
              f[0], Integer.parseInt(f[1]), Integer.parseInt(f[2]), Integer.parseInt(f[3]));
      var mechanism = SignTags.parse(f[5]).orElseThrow();
      if (!mechanism.isLift()
          || result.putIfAbsent(
                  pos,
                  new Entry(
                      UUID.fromString(f[4]),
                      f[5],
                      f.length >= 7 ? f[6] : "",
                      f.length == 8 ? f[7] : ""))
              != null)
        throw new IllegalArgumentException("invalid or duplicate historical lift at " + pos);
    }
    return Map.copyOf(result);
  }

  /**
   * Does not alter a changed sign, an already owned sign, or land the historical owner cannot edit.
   */
  void bind(Block block) {
    var loaded = catalog;
    if (loaded == null) return;
    var entry =
        loaded.get(
            new Position(block.getWorld().getName(), block.getX(), block.getY(), block.getZ()));
    if (entry == null || !(block.getState() instanceof Sign sign) || signs.hasOwnerData(sign))
      return;
    if (!PaperGrid.frontLines(sign)
        .equals(List.of("", entry.tag(), entry.thirdLine(), entry.fourthLine()))) return;
    if (entry.owner().equals(Protection.SERVER_HISTORICAL_LIFT)) {
      if (!protection.mayBindServerHistoricalLift(block.getLocation())) return;
    } else if (!protection
        .check(entry.owner(), ProtectedAction.BUILD, block.getLocation())
        .isAllowed()) {
      return;
    }
    signs.setOwner(sign, entry.owner());
    if (!sign.update(false, false))
      throw new IllegalStateException("historical lift changed at " + block.getLocation());
  }
}

package com.shepherdjerred.thestorm.creative.domain;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * One plot from the 10 January 2016 snapshot. {@code owner} is blank when the claim name is not in
 * that snapshot's playerdata, or when a build has no claim sign. The plugin never writes the file
 * these rows come from.
 */
public record RecoveredPlot(String id, String owner, List<Sign> signs) {

  private static final Pattern ID = Pattern.compile("-?\\d+;-?\\d+");
  private static final Pattern UUID_TEXT =
      Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
  private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_]{1,16}");

  public RecoveredPlot {
    if (!ID.matcher(id).matches()) {
      throw new IllegalArgumentException("creative plot id must look like x;z");
    }
    var parsed = parse(id);
    if (!parsed.text().equals(id)) {
      throw new IllegalArgumentException("creative plot id is not canonical: " + id);
    }
    if (!owner.isEmpty() && !UUID_TEXT.matcher(owner).matches()) {
      throw new IllegalArgumentException("creative plot owner must be a uuid or blank");
    }
    signs = List.copyOf(signs);
    for (var sign : signs) {
      if (sign.lines().size() != 4) {
        throw new IllegalArgumentException("creative sign must have four lines");
      }
    }
  }

  /** The player who held this plot in the snapshot, when that name matched one playerdata file. */
  public Optional<UUID> ownerId() {
    if (owner.isEmpty()) {
      return Optional.empty();
    }
    return Optional.of(UUID.fromString(owner));
  }

  /**
   * The username on the claim sign. A decorative sign in the same plot is ignored. This is the name
   * a player read in 2016, including a staff-held plot whose owner never matched a player file.
   */
  public Optional<String> signedOwner() {
    for (var sign : signs) {
      var lines = sign.lines();
      if (lines.get(0).startsWith("ID: ")
          && lines.get(1).equals("Owner:")
          && USERNAME.matcher(lines.get(2)).matches()) {
        return Optional.of(lines.get(2));
      }
    }
    return Optional.empty();
  }

  public PlotId plotId() {
    return parse(id);
  }

  private static PlotId parse(String id) {
    var parts = id.split(";", -1);
    try {
      return new PlotId(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]));
    } catch (NumberFormatException failure) {
      throw new IllegalArgumentException("creative plot id is out of range: " + id, failure);
    }
  }

  /** One sign block. The four lines are the text a player would read, with formatting removed. */
  public record Sign(int x, int y, int z, List<String> lines) {

    public Sign {
      if (x < -30_000_000 || x > 30_000_000 || z < -30_000_000 || z > 30_000_000) {
        throw new IllegalArgumentException("creative sign is outside the world");
      }
      if (y < -64 || y > 320) {
        throw new IllegalArgumentException("creative sign height is outside the world");
      }
      lines = List.copyOf(lines);
      for (var line : lines) {
        if (line.length() > 48) {
          throw new IllegalArgumentException("creative sign line is too long");
        }
      }
    }
  }
}

package com.shepherdjerred.thestorm.mechanics.domain.grid;

import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import com.shepherdjerred.thestorm.mechanics.domain.sign.SignTags;
import java.util.List;
import java.util.Optional;

/**
 * A sign as mechanisms see it.
 *
 * @param lines the front text as plain strings, exactly {@link #LINES} of them
 * @param mount how the sign is held
 * @param facing the compass direction the front text faces, empty for a standing or hanging sign
 *     turned to a diagonal
 */
public record SignView(List<String> lines, Mount mount, Optional<Direction> facing) {

  /** Lines on one side of a sign. */
  public static final int LINES = 4;

  public SignView {
    lines = List.copyOf(lines);
    if (lines.size() != LINES) {
      throw new IllegalArgumentException("a sign has " + LINES + " lines, not " + lines.size());
    }
    if (facing.isPresent() && !facing.orElseThrow().isHorizontal()) {
      throw new IllegalArgumentException("a sign faces a compass direction: " + facing);
    }
  }

  /** The mechanism named on the tag line, if any. */
  public Optional<Mechanism> mechanism() {
    return SignTags.parse(lines.get(SignTags.TAG_LINE));
  }

  public String line(int index) {
    return lines.get(index);
  }

  /** The block a wall sign hangs on. */
  public Optional<Direction> attachedFace() {
    return mount == Mount.WALL ? facing.map(Direction::opposite) : Optional.empty();
  }
}

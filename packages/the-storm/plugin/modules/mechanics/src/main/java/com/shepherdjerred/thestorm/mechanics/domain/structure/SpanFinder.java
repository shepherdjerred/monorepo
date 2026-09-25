package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.config.SpanConfig;
import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Finds bridges and doors: a line of blocks between two matching signs.
 *
 * <p><b>Bridge.</b> A {@code [Bridge]} sign has its base block directly above or below it. The
 * bridge runs away from the back of the sign, level with the base, to the base of another {@code
 * [Bridge]} sign facing back the other way. Blocks of the base's material either side of both bases
 * widen it.
 *
 * <p><b>Door.</b> A {@code [Door Up]} sign has its base directly above it; the door rises to the
 * base directly below a {@code [Door Down]} sign over it (and the reverse from the top). Blocks of
 * the base's material either side of both bases, across the sign's face, widen it.
 */
public final class SpanFinder {

  private static final List<String> BRIDGE_ENDS = List.of(Mechanism.BRIDGE.tag());
  private static final List<String> DOOR_ENDS =
      List.of(Mechanism.DOOR_UP.tag(), Mechanism.DOOR_DOWN.tag());

  private SpanFinder() {}

  /**
   * How one span is laid out around its sign.
   *
   * @param extend the direction from this end toward the other
   * @param base where this end's base block is, from the sign
   * @param farBase where the other end's base is, from its sign
   * @param across the direction the span widens in
   */
  private record Layout(Direction extend, Direction base, Direction farBase, Direction across) {}

  /** The base of the bridge whose sign is at {@code sign}: the block above, else the one below. */
  public static Result<Pos, StructureProblem> bridgeBase(
      BlockGrid grid, Pos sign, SpanConfig config) {
    var allowed = config.allowed();
    var above = sign.offset(Direction.UP);
    if (allowed.contains(grid.cellAt(above).material())) {
      return Result.ok(above);
    }
    var below = sign.offset(Direction.DOWN);
    var found = grid.cellAt(below).material();
    return allowed.contains(found)
        ? Result.ok(below)
        : Result.err(new StructureProblem.NoBase("directly above or below the sign", found));
  }

  /**
   * The base of the door whose sign ({@code [Door Up]} or {@code [Door Down]}) is at {@code sign}.
   */
  public static Result<Pos, StructureProblem> doorBase(
      BlockGrid grid, Pos sign, Mechanism mechanism, SpanConfig config) {
    var up = doorDirection(mechanism);
    var base = sign.offset(up);
    var found = grid.cellAt(base).material();
    return config.allowed().contains(found)
        ? Result.ok(base)
        : Result.err(
            new StructureProblem.NoBase(
                up == Direction.UP ? "directly above the sign" : "directly below the sign", found));
  }

  /** The bridge a {@code [Bridge]} sign at {@code sign} controls. */
  public static Result<Span, StructureProblem> bridge(
      BlockGrid grid, Pos sign, SignView view, SpanConfig config) {
    if (view.facing().isEmpty()) {
      return Result.err(new StructureProblem.NotSquare());
    }
    var extend = view.facing().orElseThrow().opposite();
    return bridgeBase(grid, sign, config)
        .flatMap(
            base -> {
              var up = sign.distanceAlong(base, Direction.UP) > 0 ? Direction.UP : Direction.DOWN;
              var layout = new Layout(extend, up, up, extend.clockwise());
              return find(new Search(grid, sign, layout, config));
            });
  }

  /** The door a {@code [Door Up]} or {@code [Door Down]} sign at {@code sign} controls. */
  public static Result<Span, StructureProblem> door(
      BlockGrid grid, Pos sign, SignView view, SpanConfig config) {
    var mechanism = view.mechanism().orElseThrow();
    if (view.facing().isEmpty()) {
      return Result.err(new StructureProblem.NotSquare());
    }
    var across = view.facing().orElseThrow().clockwise();
    var extend = doorDirection(mechanism);
    return doorBase(grid, sign, mechanism, config)
        .flatMap(
            base ->
                find(
                    new Search(
                        grid,
                        sign,
                        new Layout(extend, extend, extend.opposite(), across),
                        config)));
  }

  private static Direction doorDirection(Mechanism mechanism) {
    return switch (mechanism) {
      case DOOR_UP -> Direction.UP;
      case DOOR_DOWN -> Direction.DOWN;
      case HIDDEN_SWITCH,
          LIGHT_SWITCH,
          COOKING_POT,
          LIFT_UP,
          LIFT_DOWN,
          LIFT,
          BRIDGE,
          GATE,
          MAP_CHANGER,
          CRUSH,
          BOUNCE,
          SUPER_STICKY,
          SUPER_PUSH ->
          throw new IllegalArgumentException("not a door sign: " + mechanism);
    };
  }

  private record Search(BlockGrid grid, Pos sign, Layout layout, SpanConfig config) {

    Pos nearBase() {
      return sign.offset(layout.base());
    }

    boolean isBridge() {
      return layout.base() == layout.farBase();
    }

    Set<Mechanism> ends() {
      return isBridge() ? Set.of(Mechanism.BRIDGE) : Set.of(Mechanism.DOOR_UP, Mechanism.DOOR_DOWN);
    }

    List<String> endTags() {
      return isBridge() ? BRIDGE_ENDS : DOOR_ENDS;
    }
  }

  private static Result<Span, StructureProblem> find(Search search) {
    var ends = search.ends();
    var grid = search.grid();
    var layout = search.layout();
    var nearBase = search.nearBase();
    for (var step = 1; ; step++) {
      var candidate = search.sign().offset(layout.extend(), step);
      var farBase = candidate.offset(layout.farBase());
      var length = nearBase.distanceAlong(farBase, layout.extend()) - 1;
      if (!grid.contains(candidate) || length > search.config().maxLength()) {
        return Result.err(
            new StructureProblem.NoFarEnd(search.endTags(), search.config().maxLength()));
      }
      var isEnd =
          grid.signAt(candidate).flatMap(SignView::mechanism).filter(ends::contains).isPresent();
      if (isEnd) {
        return length < 1
            ? Result.err(new StructureProblem.TooShort())
            : span(search, farBase, candidate);
      }
    }
  }

  private static Result<Span, StructureProblem> span(Search search, Pos farBase, Pos farSign) {
    var grid = search.grid();
    var layout = search.layout();
    var nearBase = search.nearBase();
    var material = grid.cellAt(nearBase).material();
    var farMaterial = grid.cellAt(farBase).material();
    if (!farMaterial.equals(material)) {
      return Result.err(new StructureProblem.EndsDiffer(material, farMaterial));
    }
    var max = search.config().maxWidthEachSide();
    var right = widthToward(grid, nearBase, layout.across(), max);
    var left = widthToward(grid, nearBase, layout.across().opposite(), max);
    for (var offset = -left; offset <= right; offset++) {
      if (!grid.cellAt(farBase.offset(layout.across(), offset)).is(material)) {
        return Result.err(new StructureProblem.WidthsDiffer());
      }
    }
    var length = nearBase.distanceAlong(farBase, layout.extend()) - 1;
    var cells = new ArrayList<Pos>();
    for (var along = 1; along <= length; along++) {
      var row = nearBase.offset(layout.extend(), along);
      for (var offset = -left; offset <= right; offset++) {
        cells.add(row.offset(layout.across(), offset));
      }
    }
    return Result.ok(new Span(new Structure(material, nearBase, cells), farSign));
  }

  private static int widthToward(BlockGrid grid, Pos base, Direction side, int max) {
    var material = grid.cellAt(base).material();
    var width = 0;
    while (width < max && grid.cellAt(base.offset(side, width + 1)).is(material)) {
      width++;
    }
    return width;
  }
}

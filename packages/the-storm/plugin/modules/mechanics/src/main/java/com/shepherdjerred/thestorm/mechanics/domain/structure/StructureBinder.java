package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.Names;
import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.SpanConfig;
import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Box;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Binds structure signs to their structure when they are written, and checks the binding on every
 * use.
 *
 * <p><b>Bridges and doors</b> link exactly two end signs to each other. The first end written is
 * bound alone; writing the second finds the first (it must be set up and not linked to another
 * living end), and links both. The first end keeps the structure's stock; the second holds none.
 * Either end toggles, and only the two linked signs are ever read or written.
 *
 * <p><b>Gates</b> bind a sign to the column tops found when it is written. A second gate sign that
 * finds exactly the same columns (a gate worked from both sides) links to the first, like a
 * bridge's ends: the first keeps the stock and either toggles. Any other gate sign is never read
 * for stock or written.
 *
 * <p>On use the structure must still match its binding (same partner, material and base blocks, or
 * the same column tops), or the use is refused. Writing a structure sign that holds blocks is
 * refused, so a sign's stock can never be orphaned by a rewrite.
 */
public final class StructureBinder {

  private final MechanicsConfig config;

  public StructureBinder(MechanicsConfig config) {
    this.config = config;
  }

  /**
   * A structure sign in its world.
   *
   * @param grid the blocks
   * @param records the signs
   * @param sign where the sign is
   * @param view what it reads (for a new sign, its new text)
   */
  public record Site(BlockGrid grid, SignRecords records, Pos sign, SignView view) {

    Mechanism mechanism() {
      return view.mechanism().orElseThrow();
    }
  }

  /**
   * A binding to store on a sign.
   *
   * @param sign where
   * @param binding what
   */
  public record Write(Pos sign, Binding binding) {}

  /**
   * What writing a structure sign binds.
   *
   * @param writes the bindings to store
   * @param cells the structure's spaces, which the writer must be allowed to change; empty for a
   *     first end with nothing to link to yet
   */
  public record Bind(List<Write> writes, List<Pos> cells) {

    public Bind {
      writes = List.copyOf(writes);
      cells = List.copyOf(cells);
    }
  }

  /**
   * A structure ready to plan.
   *
   * @param structure its cells
   * @param keeper the sign that holds its stock
   */
  public record Bound(Structure structure, Pos keeper) {}

  /** The bindings to store for a sign just written as a bridge, door or gate. */
  public Result<Bind, StructureProblem> bind(Site site) {
    var own = site.records().at(site.sign());
    var held = own.map(SignRecord::stock).orElseGet(Stock::empty);
    if (!held.isEmpty()) {
      return Result.err(new StructureProblem.HoldsStock(held));
    }
    return switch (site.mechanism().feature()) {
      case BRIDGE, DOOR -> bindSpan(site);
      case GATE -> bindGate(site);
      case HIDDEN_SWITCH,
          LIGHT_SWITCH,
          COOKING_POT,
          BLOCK_DROPS,
          ELEVATOR,
          SIGN_COPIER,
          PAINTING_SWITCHER,
          CRUSH,
          BOUNCE,
          SUPER_STICKY,
          SUPER_PUSH ->
          throw new IllegalArgumentException("not a structure: " + site.mechanism());
    };
  }

  /** The structure a used sign controls, checked against its binding. */
  public Result<Bound, StructureProblem> resolve(Site site) {
    var binding = site.records().at(site.sign()).flatMap(SignRecord::binding);
    if (binding.isEmpty()) {
      return Result.err(new StructureProblem.NotBound());
    }
    var gateSign = site.mechanism().feature() == Feature.GATE;
    return switch (binding.orElseThrow()) {
      case Binding.SpanEnd end when !gateSign -> resolveSpan(site, end);
      case Binding.GateFrame frame when gateSign -> resolveGate(site, frame);
      case Binding.SpanEnd _, Binding.GateFrame _ -> Result.err(new StructureProblem.NotBound());
    };
  }

  private SpanConfig spanConfig(Mechanism mechanism) {
    return mechanism.feature() == Feature.BRIDGE ? config.bridge() : config.door();
  }

  private Result<Span, StructureProblem> findSpan(Site site) {
    var mechanism = site.mechanism();
    var spanConfig = spanConfig(mechanism);
    return mechanism.feature() == Feature.BRIDGE
        ? SpanFinder.bridge(site.grid(), site.sign(), site.view(), spanConfig)
        : SpanFinder.door(site.grid(), site.sign(), site.view(), spanConfig);
  }

  private Result<Bind, StructureProblem> bindSpan(Site site) {
    var mechanism = site.mechanism();
    var base =
        mechanism.feature() == Feature.BRIDGE
            ? SpanFinder.bridgeBase(site.grid(), site.sign(), spanConfig(mechanism))
            : SpanFinder.doorBase(site.grid(), site.sign(), mechanism, spanConfig(mechanism));
    return base.flatMap(
        anchor ->
            switch (findSpan(site)) {
              case Result.Ok<Span, StructureProblem>(var span) -> link(site, span);
              case Result.Err<Span, StructureProblem>(StructureProblem.NoFarEnd _) -> {
                var alone =
                    new Binding.SpanEnd(
                        site.grid().cellAt(anchor).material(), anchor, Optional.empty(), true);
                yield Result.ok(new Bind(List.of(new Write(site.sign(), alone)), List.of()));
              }
              case Result.Err<Span, StructureProblem>(var problem) -> Result.err(problem);
            });
  }

  private Result<Bind, StructureProblem> link(Site site, Span span) {
    var far = span.farSign();
    var farEnd = site.records().at(far).flatMap(record -> record.spanEndFor(site.mechanism()));
    if (farEnd.isEmpty()) {
      return Result.err(new StructureProblem.FarNotSetUp(far));
    }
    var other = farEnd.orElseThrow();
    var farPartner = other.partner();
    if (farPartner.isPresent()
        && !farPartner.orElseThrow().equals(site.sign())
        && linksBack(site, farPartner.orElseThrow(), far)) {
      return Result.err(new StructureProblem.FarTaken(far));
    }
    var structure = span.structure();
    if (!other.anchor().equals(span.farBase()) || !other.material().equals(structure.material())) {
      return Result.err(new StructureProblem.Changed("the other end's block was replaced"));
    }
    var standing =
        structure.cells().stream()
            .filter(pos -> site.grid().cellAt(pos).is(structure.material()))
            .toList();
    return StructureToggle.movable(standing, site.grid())
        .map(
            ok ->
                new Bind(
                    List.of(
                        new Write(
                            site.sign(),
                            new Binding.SpanEnd(
                                structure.material(),
                                structure.template(),
                                Optional.of(far),
                                false)),
                        new Write(
                            far,
                            new Binding.SpanEnd(
                                other.material(), other.anchor(), Optional.of(site.sign()), true))),
                    structure.cells()));
  }

  /** Whether the sign at {@code partner} is a living end linked to {@code end}. */
  private static boolean linksBack(Site site, Pos partner, Pos end) {
    return site.records()
        .at(partner)
        .flatMap(record -> record.spanEndFor(site.mechanism()))
        .flatMap(Binding.SpanEnd::partner)
        .filter(end::equals)
        .isPresent();
  }

  private Result<Bind, StructureProblem> bindGate(Site site) {
    var gateConfig = config.gate();
    return GateFinder.find(site.grid(), site.sign(), gateConfig)
        .flatMap(
            gate -> {
              var structure = GateFinder.columns(site.grid(), gate, gateConfig.maxHeight());
              var standing =
                  structure.cells().stream()
                      .filter(pos -> site.grid().cellAt(pos).is(gate.material()))
                      .toList();
              // The creator must be allowed to change the tops too: they anchor the gate.
              var cells = new ArrayList<>(structure.cells());
              cells.addAll(gate.tops());
              return StructureToggle.movable(standing, site.grid())
                  .map(ok -> new Bind(gateWrites(site, gate), cells));
            });
  }

  /** Links to a gate sign that already frames the same columns, else binds this sign alone. */
  private List<Write> gateWrites(Site site, Gate gate) {
    var radius = 2 * config.gate().searchRadius();
    var twin =
        Box.around(site.sign(), radius).stream()
            .filter(pos -> !pos.equals(site.sign()))
            .filter(pos -> isFreeTwin(site, pos, gate))
            .min(
                Comparator.<Pos>comparingLong(pos -> pos.distanceSquared(site.sign()))
                    .thenComparing(Pos.ORDER));
    if (twin.isEmpty()) {
      return List.of(new Write(site.sign(), new Binding.GateFrame(gate, Optional.empty(), true)));
    }
    var keeper = twin.orElseThrow();
    var other = site.records().at(keeper).flatMap(SignRecord::gateFrame).orElseThrow();
    return List.of(
        new Write(site.sign(), new Binding.GateFrame(gate, Optional.of(keeper), false)),
        new Write(keeper, new Binding.GateFrame(other.gate(), Optional.of(site.sign()), true)));
  }

  /** A gate sign framing {@code gate}'s columns and not linked to another living gate sign. */
  private static boolean isFreeTwin(Site site, Pos pos, Gate gate) {
    var frame = site.records().at(pos).flatMap(SignRecord::gateFrame);
    if (frame.isEmpty() || !sameColumns(frame.orElseThrow().gate(), gate)) {
      return false;
    }
    var partner = frame.orElseThrow().partner();
    return partner.isEmpty()
        || partner.orElseThrow().equals(site.sign())
        || !gateLinksBack(site, partner.orElseThrow(), pos);
  }

  private static boolean sameColumns(Gate first, Gate second) {
    return first.material().equals(second.material())
        && Set.copyOf(first.tops()).equals(Set.copyOf(second.tops()));
  }

  /** Whether the gate sign at {@code partner} is linked to the one at {@code sign}. */
  private static boolean gateLinksBack(Site site, Pos partner, Pos sign) {
    return site.records()
        .at(partner)
        .flatMap(SignRecord::gateFrame)
        .flatMap(Binding.GateFrame::partner)
        .filter(sign::equals)
        .isPresent();
  }

  private Result<Bound, StructureProblem> resolveSpan(Site site, Binding.SpanEnd end) {
    if (end.partner().isEmpty()) {
      var tags =
          site.mechanism().feature() == Feature.BRIDGE
              ? Mechanism.BRIDGE.tag()
              : Mechanism.DOOR_UP.tag() + " or " + Mechanism.DOOR_DOWN.tag();
      return Result.err(new StructureProblem.NotLinked(tags));
    }
    var partner = end.partner().orElseThrow();
    var partnerEnd =
        site.records()
            .at(partner)
            .flatMap(record -> record.spanEndFor(site.mechanism()))
            .filter(other -> other.partner().filter(site.sign()::equals).isPresent());
    if (partnerEnd.isEmpty()) {
      return Result.err(new StructureProblem.PartnerMissing(partner));
    }
    var other = partnerEnd.orElseThrow();
    if (end.keeper() == other.keeper()) {
      throw new IllegalStateException(
          "exactly one end keeps the stock: " + site.sign() + " and " + partner);
    }
    return findSpan(site)
        .flatMap(
            span -> {
              var structure = span.structure();
              if (!span.farSign().equals(partner)) {
                return Result.err(
                    new StructureProblem.Changed("another sign now stands between the ends"));
              }
              if (!structure.material().equals(end.material())
                  || !structure.template().equals(end.anchor())
                  || !span.farBase().equals(other.anchor())) {
                return Result.err(new StructureProblem.Changed("an end block was replaced"));
              }
              return Result.ok(new Bound(structure, end.keeper() ? site.sign() : partner));
            });
  }

  private Result<Bound, StructureProblem> resolveGate(Site site, Binding.GateFrame frame) {
    var gate = frame.gate();
    var keeper = site.sign();
    if (frame.partner().isPresent()) {
      var partner = frame.partner().orElseThrow();
      var other =
          site.records()
              .at(partner)
              .flatMap(SignRecord::gateFrame)
              .filter(twin -> twin.partner().filter(site.sign()::equals).isPresent())
              .filter(twin -> sameColumns(twin.gate(), gate));
      if (other.isEmpty()) {
        return Result.err(new StructureProblem.PartnerMissing(partner));
      }
      if (other.orElseThrow().keeper() == frame.keeper()) {
        throw new IllegalStateException(
            "exactly one gate sign keeps the stock: " + site.sign() + " and " + partner);
      }
      keeper = frame.keeper() ? site.sign() : partner;
    }
    for (var top : gate.tops()) {
      if (!GateFinder.isTop(site.grid(), top, gate.material())) {
        return Result.err(
            new StructureProblem.Changed("the column top at " + Names.pos(top) + " moved"));
      }
    }
    var structure = GateFinder.columns(site.grid(), gate, config.gate().maxHeight());
    return Result.ok(new Bound(structure, keeper));
  }
}

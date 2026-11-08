package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import java.util.List;

/** Stargate's original creation layout and its rendered {@code -Name- / (Network)} layout. */
public final class GateSignText {
  private GateSignText() {}

  public static boolean rendered(List<String> lines) {
    return wrapped(lines.getFirst().strip(), "-", "-") && wrapped(lines.get(3).strip(), "(", ")");
  }

  public static String name(List<String> lines) {
    var first = lines.getFirst().strip();
    return rendered(lines) ? unwrap(first) : first;
  }

  public static String network(List<String> lines) {
    return rendered(lines) ? unwrap(lines.get(3).strip()) : lines.get(2).strip();
  }

  public static String destination(List<String> lines) {
    var destination = lines.get(1).strip();
    return wrapped(destination, ">", "<") ? unwrap(destination) : destination;
  }

  public static boolean matches(SignView sign, Stargate gate, StargateNetwork network) {
    var lines = List.of(sign.line(0), sign.line(1), sign.line(2), sign.line(3));
    return name(lines).equals(gate.name())
        && network(lines).equalsIgnoreCase(network.name())
        && (gate.fixedDestination() == null
            || destination(lines).equalsIgnoreCase(gate.fixedDestination()))
        && (rendered(lines) || !gate.alwaysOpen() || lines.get(3).strip().equalsIgnoreCase("A"));
  }

  public static List<String> display(Stargate gate, StargateNetwork network, String selection) {
    var destination = gate.fixedDestination();
    if (destination == null && !selection.isBlank()) destination = selection;
    return List.of(
        "-" + gate.name() + "-",
        destination == null ? "Right click" : ">" + destination + "<",
        destination == null ? "to use gate" : "",
        "(" + network.name() + ")");
  }

  private static boolean wrapped(String value, String left, String right) {
    return value.length() > 2 && value.startsWith(left) && value.endsWith(right);
  }

  private static String unwrap(String value) {
    return value.substring(1, value.length() - 1).strip();
  }
}

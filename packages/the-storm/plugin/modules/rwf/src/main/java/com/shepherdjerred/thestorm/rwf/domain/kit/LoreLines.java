// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/utils/UtilText.java, splitLine;
// redwarfare-core/src/me/libraryaddict/core/inventory/utils/ItemBuilder.java, addLore; and
// redwarfare-core/src/me/libraryaddict/core/utils/LineFormat.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.ArrayList;
import java.util.List;

/**
 * Lore laid out exactly as Red Warfare's {@code ItemBuilder.addLore} laid it out: each added line
 * carries on the colours the last line ended in and is broken into lines by {@code
 * UtilText.splitLine} at its {@code LineFormat.LORE} width, counting each space as four and each
 * word with the colours carried into it. Text is Minecraft's legacy section-sign format.
 */
public final class LoreLines {

  /** {@code LineFormat.LORE}'s width. */
  public static final int LORE = 50;

  private static final char SECTION = '§';
  private static final String COLORS = "0123456789abcdef";
  private static final String FORMATS = "klmno";

  private LoreLines() {}

  /** {@code lore} with {@code line} added, as {@code addLore(line)} added it. */
  public static List<String> add(List<String> lore, String line) {
    var color = lore.isEmpty() ? "" : lastColors(lore.getLast());
    var next = new ArrayList<>(lore);
    next.addAll(split(color + line, LORE));
    return List.copyOf(next);
  }

  /** {@code lines} added one after another. */
  public static List<String> of(List<String> lines) {
    var lore = List.<String>of();
    for (var line : lines) {
      lore = add(lore, line);
    }
    return lore;
  }

  /** {@code UtilText.splitLine}. */
  public static List<String> split(String text, int width) {
    var lines = new ArrayList<String>();
    if (text.trim().isEmpty()) {
      lines.add(text);
      return lines;
    }
    var current = new StringBuilder();
    var length = 0;
    var words = words(text);
    var colors = "";
    for (var i = 0; i < words.size(); i++) {
      var word = words.get(i);
      var wordLength = (colors + word).length();
      if (length + wordLength + 4 > width && !current.isEmpty()) {
        lines.add(current.toString());
        current.setLength(0);
        current.append(colors).append(word);
        length = wordLength + 1;
        continue;
      }
      if (i != 0) {
        current.append(' ');
        length += 4;
      }
      current.append(word);
      length += wordLength;
      colors = lastColors(current.toString());
    }
    if (!current.isEmpty()) {
      lines.add(current.toString());
    }
    return lines;
  }

  /**
   * {@code text} split at each space as Java's {@code String.split(" ")} split it, the original's
   * call: empty words between spaces kept, trailing ones dropped.
   */
  private static List<String> words(String text) {
    var words = new ArrayList<String>();
    var start = 0;
    for (var i = 0; i <= text.length(); i++) {
      if (i == text.length() || text.charAt(i) == ' ') {
        words.add(text.substring(start, i));
        start = i + 1;
      }
    }
    while (!words.isEmpty() && words.getLast().isEmpty()) {
      words.removeLast();
    }
    return words;
  }

  /**
   * Bukkit's {@code ChatColor.getLastColors}: the colour and formats in force at the end of {@code
   * text}, read backwards to the last colour or reset.
   */
  public static String lastColors(String text) {
    var result = new StringBuilder();
    for (var i = text.length() - 1; i > 0; i--) {
      if (text.charAt(i - 1) != SECTION) {
        continue;
      }
      var code = text.charAt(i);
      if (COLORS.indexOf(code) >= 0 || code == 'r') {
        result.insert(0, "" + SECTION + code);
        break;
      }
      if (FORMATS.indexOf(code) >= 0) {
        result.insert(0, "" + SECTION + code);
      }
    }
    return result.toString();
  }
}

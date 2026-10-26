package com.shepherdjerred.thestorm.creative.adapter.bluemap;

/** The name drawn on a plot. Screen text, centered on the plot, that does not catch map clicks. */
final class PlotNameHtml {

  private static final String STYLE =
      "color:#fff;font:600 16px sans-serif;text-shadow:0 1px 2px #000,0 0 4px #000;"
          + "white-space:nowrap;pointer-events:none;transform:translate(-50%,-50%)";

  private PlotNameHtml() {}

  static String of(String label) {
    return "<div style=\"" + STYLE + "\">" + escape(label) + "</div>";
  }

  private static String escape(String text) {
    return text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;");
  }
}

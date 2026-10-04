package com.shepherdjerred.castlecasters.game.desktop;

/** The original help page's rules, paired with the current desktop controls. */
final class HowToPlayView {
  private HowToPlayView() {}

  static void draw(GameCanvas canvas) {
    canvas.rect(115, 55, 1130, 650, .035f, .07f, .065f, .96f);
    canvas.rect(115, 55, 1130, 2, .71f, .62f, .38f, 1);
    canvas.text("HOW TO PLAY", 155, 115, 1.9f, .9f, .8f, .52f);
    canvas.text("Race your witch or wizard to the opposite edge.", 155, 157, 1.2f);
    card(
        canvas,
        155,
        190,
        "01",
        "MOVE YOUR CASTER",
        "On your turn, move OR cast a wall.",
        "Move one space up, down, left or right.",
        "Click a green destination to move.",
        "Reach any space on your far edge to win.");
    card(
        canvas,
        705,
        190,
        "02",
        "CAST MAGICAL WALLS",
        "Each caster starts with 10 walls.",
        "A wall spans two spaces. Use walls to",
        "make your rivals take a longer route.",
        "No overlaps, crossings, or sealed paths.");
    card(
        canvas,
        155,
        395,
        "03",
        "JUMP OVER RIVALS",
        "Next to a rival? Jump straight over them.",
        "If a wall, board edge, or another caster",
        "blocks the landing, jump diagonally.",
        "Green markers show every legal jump.");
    card(
        canvas,
        705,
        395,
        "04",
        "PLACE AND ROTATE",
        "W: select wall.  R: rotate.  V: vertical.",
        "Left click a legal preview to cast.",
        "Right click also casts a wall.",
        "M: move.  Esc: cancel wall placement.");
    canvas.text("Two or four casters: play with friends, AI, or remote players.", 155, 629, 1.05f);
  }

  private static void card(
      GameCanvas canvas, float x, float y, String number, String title, String... lines) {
    canvas.rect(x, y, 500, 180, .065f, .12f, .105f, 1);
    canvas.rect(x, y, 3, 180, .39f, .48f, .29f, 1);
    canvas.text(number, x + 20, y + 36, 1.2f, .9f, .8f, .52f);
    canvas.text(title, x + 67, y + 36, 1.15f);
    for (int i = 0; i < lines.length; i++) canvas.text(lines[i], x + 20, y + 74 + i * 27, 1.02f);
  }
}

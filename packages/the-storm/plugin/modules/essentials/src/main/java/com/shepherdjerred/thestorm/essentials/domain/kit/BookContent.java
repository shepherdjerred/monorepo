package com.shepherdjerred.thestorm.essentials.domain.kit;

import java.util.List;

/**
 * A written book: the rules book and books handed out in kits.
 *
 * @param title the title, at most 32 characters (the game's limit)
 * @param author the author shown under the title
 * @param pages the pages, as MiniMessage text
 */
public record BookContent(String title, String author, List<String> pages) {

  /** The game's limit on a written book's title. */
  public static final int MAX_TITLE_LENGTH = 32;

  /** The game's limit on a written book's pages. */
  public static final int MAX_PAGES = 100;

  public BookContent {
    if (title.isBlank() || title.length() > MAX_TITLE_LENGTH) {
      throw new IllegalArgumentException("title must be 1-" + MAX_TITLE_LENGTH + " characters");
    }
    if (author.isBlank()) {
      throw new IllegalArgumentException("author must not be blank");
    }
    if (pages.isEmpty() || pages.size() > MAX_PAGES) {
      throw new IllegalArgumentException("a book has 1-" + MAX_PAGES + " pages");
    }
    if (pages.stream().anyMatch(String::isBlank)) {
      throw new IllegalArgumentException("pages must not be blank");
    }
    pages = List.copyOf(pages);
  }
}

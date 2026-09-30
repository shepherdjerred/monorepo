package com.shepherdjerred.thestorm.agent.domain;

import java.util.List;

/**
 * One known answer, as the matcher reads it.
 *
 * @param id the slug, for example {@code starter-kit}
 * @param keywords trigger phrases, matched case-insensitively
 * @param reply the answer, posted publicly
 * @param link where to read more; blank when there is nowhere
 */
public record FaqEntry(String id, List<String> keywords, String reply, String link) {
  public FaqEntry {
    if (id.isBlank()) {
      throw new IllegalArgumentException("faq entry id must not be blank");
    }
    if (keywords.isEmpty()) {
      throw new IllegalArgumentException("faq entry " + id + " needs at least one keyword");
    }
    if (reply.isBlank()) {
      throw new IllegalArgumentException("faq entry " + id + " reply must not be blank");
    }
    keywords = List.copyOf(keywords);
  }
}

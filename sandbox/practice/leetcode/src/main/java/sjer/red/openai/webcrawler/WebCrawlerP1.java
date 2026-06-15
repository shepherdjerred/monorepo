package sjer.red.openai.webcrawler;

import java.util.List;
import java.util.Set;
import java.util.function.Function;

/**
 * PROBLEM: Web Crawler
 * <p>
 * Implement a web crawler that performs BFS traversal of web pages.
 * <p>
 * PART 1:
 * - crawl(startUrl, getLinks) — given a start URL and a function that returns
 * links on a page, return all reachable URLs
 * - getLinks(url) -> List<String> of URLs found on that page
 * - Only crawl URLs within the same domain as startUrl
 * - Deduplicate — never visit the same URL twice
 * - Return the set of all visited URLs
 * <p>
 * Example:
 * startUrl = "https://example.com"
 * getLinks("https://example.com") -> ["https://example.com/about", "https://other.com"]
 * getLinks("https://example.com/about") -> ["https://example.com/contact"]
 * crawl -> {"https://example.com", "https://example.com/about", "https://example.com/contact"}
 * <p>
 * TIME TARGET: ~15-20 minutes
 */
public class WebCrawlerP1 {

    /**
     * Single-threaded BFS web crawler.
     * Only crawl URLs with the same domain as startUrl.
     */
    public Set<String> crawl(String startUrl, Function<String, List<String>> getLinks) {
        // TODO: implement BFS with deduplication
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Helper: extract domain from URL.
     */
    protected String getDomain(String url) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}

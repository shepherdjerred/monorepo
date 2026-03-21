package sjer.red.openai.webcrawler;

import java.util.List;
import java.util.Set;
import java.util.function.Function;

/**
 * PROBLEM: Web Crawler
 * <p>
 * PART 2: Depth Limiting
 * - Add depth limiting — only crawl up to maxDepth levels from startUrl
 * - startUrl is depth 0
 * - crawl(startUrl, getLinks) still works as before (unlimited depth)
 * - crawl(startUrl, getLinks, maxDepth) limits traversal depth
 * <p>
 * Example:
 * startUrl = "https://f.com"
 * getLinks("https://f.com") -> ["https://f.com/a", "https://f.com/b"]
 * getLinks("https://f.com/a") -> ["https://f.com/deep"]
 * crawl("https://f.com", getLinks, 1) -> {"https://f.com", "https://f.com/a", "https://f.com/b"}
 * (https://f.com/deep excluded — depth 2 exceeds maxDepth of 1)
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~25-35 minutes)
 */
public class WebCrawlerP2 {

    /**
     * Single-threaded BFS web crawler (unlimited depth).
     * Only crawl URLs with the same domain as startUrl.
     */
    public Set<String> crawl(String startUrl, Function<String, List<String>> getLinks) {
        // TODO: implement BFS with deduplication
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * BFS with depth limiting.
     * startUrl is depth 0. Only follow links up to maxDepth levels.
     */
    public Set<String> crawl(String startUrl, Function<String, List<String>> getLinks, int maxDepth) {
        // TODO: implement with depth tracking
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

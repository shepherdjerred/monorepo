package sjer.red.openai.webcrawler;

import java.util.List;
import java.util.Set;
import java.util.function.Function;

/**
 * PROBLEM: Web Crawler
 * <p>
 * PART 4: Rate Limiting
 * - Add rate limiting — max N requests per second per domain
 * - Don't overwhelm any single host
 * <p>
 * Example:
 * crawl("https://example.com", getLinks, Integer.MAX_VALUE, 4, 10)
 * — uses 4 threads, max 10 requests per second per domain
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~50-70 minutes)
 */
public class WebCrawlerP4 {

    /**
     * BFS web crawler with depth limiting, configurable thread count, and rate limiting.
     * startUrl is depth 0. Only follow links up to maxDepth levels.
     * Only crawl URLs with the same domain as startUrl.
     *
     * @param numThreads           number of worker threads
     * @param maxRequestsPerSecond max requests per second per domain
     */
    public Set<String> crawl(String startUrl, Function<String, List<String>> getLinks,
                             int maxDepth, int numThreads, int maxRequestsPerSecond) {
        // TODO: implement with rate limiting
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

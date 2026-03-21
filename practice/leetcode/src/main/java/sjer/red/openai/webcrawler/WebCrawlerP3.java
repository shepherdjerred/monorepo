package sjer.red.openai.webcrawler;

import java.util.List;
import java.util.Set;
import java.util.function.Function;

/**
 * PROBLEM: Web Crawler
 * <p>
 * PART 3: Multithreading
 * - Make the crawler multithreaded with a configurable number of worker threads
 * - Thread-safe deduplication
 * - Proper shutdown when all work is done
 * - All previous methods (crawl, crawl with maxDepth) still work
 * <p>
 * Example:
 * crawlMultithreaded("https://mt.com/start", getLinks, 4)
 * — uses 4 worker threads, returns same results as single-threaded crawl
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~40-55 minutes)
 */
public class WebCrawlerP3 {

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
     * Multithreaded crawler.
     *
     * @param numThreads number of worker threads
     */
    public Set<String> crawlMultithreaded(String startUrl, Function<String, List<String>> getLinks, int numThreads) {
        // TODO: implement with thread pool, concurrent deduplication
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

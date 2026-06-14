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
 * <p>
 * Example:
 * crawl("https://mt.com/start", getLinks, Integer.MAX_VALUE, 4)
 * — uses 4 worker threads, returns same results as single-threaded crawl
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~40-55 minutes)
 */
public class WebCrawlerP3 {

    /**
     * BFS web crawler with depth limiting and configurable thread count.
     * startUrl is depth 0. Only follow links up to maxDepth levels.
     * Only crawl URLs with the same domain as startUrl.
     *
     * @param numThreads number of worker threads
     */
    public Set<String> crawl(String startUrl, Function<String, List<String>> getLinks, int maxDepth, int numThreads) {
        // TODO: implement with thread pool, concurrent deduplication, depth tracking
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

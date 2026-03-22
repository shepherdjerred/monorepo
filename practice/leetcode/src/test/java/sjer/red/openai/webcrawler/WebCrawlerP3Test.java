package sjer.red.openai.webcrawler;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

class WebCrawlerP3Test {
    private WebCrawlerP3 crawler;
    private Map<String, List<String>> graph;

    private static String fingerprint(Set<String> urls) {
        try {
            var sorted = new ArrayList<>(urls);
            Collections.sort(sorted);
            var md = MessageDigest.getInstance("SHA-256");
            for (var url : sorted) {
                md.update(url.getBytes(StandardCharsets.UTF_8));
                md.update((byte) '\n');
            }
            byte[] hash = md.digest();
            var sb = new StringBuilder();
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @BeforeEach
    void setUp() {
        crawler = new WebCrawlerP3();
        graph = new HashMap<>();
    }

    // A tests: unlimited depth, single thread

    @Test
    void scenario_A1_simple_graph() {
        graph.put("https://a.com", List.of("https://a.com/x", "https://a.com/y"));
        graph.put("https://a.com/x", List.of("https://a.com/y"));
        graph.put("https://a.com/y", List.of());
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 1);
        assertEquals(3, result.size());
        assertTrue(result.contains("https://a.com"));
        assertTrue(result.contains("https://a.com/x"));
        assertTrue(result.contains("https://a.com/y"));
    }

    @Test
    void scenario_A2_cross_domain_filtered() {
        graph.put("https://a.com", List.of("https://a.com/p", "https://b.com/q"));
        graph.put("https://a.com/p", List.of());
        graph.put("https://b.com/q", List.of("https://b.com/r"));
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 1);
        assertEquals(2, result.size());
        assertFalse(result.contains("https://b.com/q"));
    }

    @Test
    void scenario_A3_cycle() {
        graph.put("https://c.com", List.of("https://c.com/a"));
        graph.put("https://c.com/a", List.of("https://c.com/b"));
        graph.put("https://c.com/b", List.of("https://c.com"));
        var result = crawler.crawl("https://c.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 1);
        assertEquals(3, result.size());
    }

    @Test
    void scenario_A4_isolated() {
        graph.put("https://solo.com", List.of());
        var result = crawler.crawl("https://solo.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 1);
        assertEquals(1, result.size());
        assertTrue(result.contains("https://solo.com"));
    }

    @Test
    void scenario_A5_dedup() {
        graph.put("https://d.com", List.of("https://d.com/a", "https://d.com/b"));
        graph.put("https://d.com/a", List.of("https://d.com/c"));
        graph.put("https://d.com/b", List.of("https://d.com/c"));
        graph.put("https://d.com/c", List.of());
        var result = crawler.crawl("https://d.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 1);
        assertEquals(4, result.size());
    }

    // E tests: getDomain

    @Test
    void scenario_E1_domain() {
        assertEquals("example.com", crawler.getDomain("https://example.com/path/to/page"));
    }

    @Test
    void scenario_E2_domain_with_port() {
        assertEquals("localhost:8080", crawler.getDomain("http://localhost:8080/api"));
    }

    // B tests: depth limiting, single thread

    @Test
    void scenario_B1_depth_zero() {
        graph.put("https://e.com", List.of("https://e.com/a"));
        graph.put("https://e.com/a", List.of());
        var result = crawler.crawl("https://e.com", url -> graph.getOrDefault(url, List.of()), 0, 1);
        assertEquals(1, result.size());
        assertTrue(result.contains("https://e.com"));
    }

    @Test
    void scenario_B2_depth_one() {
        graph.put("https://f.com", List.of("https://f.com/a", "https://f.com/b"));
        graph.put("https://f.com/a", List.of("https://f.com/deep"));
        graph.put("https://f.com/b", List.of());
        graph.put("https://f.com/deep", List.of());
        var result = crawler.crawl("https://f.com", url -> graph.getOrDefault(url, List.of()), 1, 1);
        assertEquals(3, result.size());
        assertFalse(result.contains("https://f.com/deep"));
    }

    @Test
    void scenario_B3_depth_sufficient() {
        graph.put("https://g.com", List.of("https://g.com/1"));
        graph.put("https://g.com/1", List.of("https://g.com/2"));
        graph.put("https://g.com/2", List.of());
        var result = crawler.crawl("https://g.com", url -> graph.getOrDefault(url, List.of()), 10, 1);
        assertEquals(3, result.size());
    }

    // C tests: multithreaded correctness

    @Test
    void scenario_C1_multithreaded_correctness() {
        // Build a larger graph
        for (int i = 0; i < 20; i++) {
            var links = new ArrayList<String>();
            for (int j = i + 1; j < Math.min(i + 4, 20); j++) {
                links.add("https://mt.com/" + j);
            }
            graph.put("https://mt.com/" + i, links);
        }
        graph.put("https://mt.com/start", List.of("https://mt.com/0"));
        var single = crawler.crawl("https://mt.com/start",
                url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 1);
        var multi = crawler.crawl("https://mt.com/start",
                url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 4);
        // Both should find the same URLs
        assertEquals(fingerprint(single), fingerprint(multi));
    }

    @Test
    void scenario_C2_large_graph_thread_comparison() {
        // Build a 50-node graph
        for (int i = 0; i < 50; i++) {
            var links = new java.util.ArrayList<String>();
            for (int j = i + 1; j < Math.min(i + 4, 50); j++) {
                links.add("https://lg.com/" + j);
            }
            graph.put("https://lg.com/" + i, links);
        }
        graph.put("https://lg.com/start", List.of("https://lg.com/0"));
        var single = crawler.crawl("https://lg.com/start",
                url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 1);
        var multi = crawler.crawl("https://lg.com/start",
                url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 8);
        assertEquals(fingerprint(single), fingerprint(multi));
    }

    @Test
    void scenario_C3_single_thread_matches_p1() {
        graph.put("https://a.com", List.of("https://a.com/x", "https://a.com/y"));
        graph.put("https://a.com/x", List.of("https://a.com/y"));
        graph.put("https://a.com/y", List.of());
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE, 1);
        assertEquals(3, result.size());
        assertTrue(result.contains("https://a.com"));
        assertTrue(result.contains("https://a.com/x"));
        assertTrue(result.contains("https://a.com/y"));
    }

    @Test
    void scenario_C4_depth_limited_multithreaded() {
        graph.put("https://dl.com", List.of("https://dl.com/a", "https://dl.com/b"));
        graph.put("https://dl.com/a", List.of("https://dl.com/deep"));
        graph.put("https://dl.com/b", List.of("https://dl.com/deep2"));
        graph.put("https://dl.com/deep", List.of());
        graph.put("https://dl.com/deep2", List.of());
        var result = crawler.crawl("https://dl.com", url -> graph.getOrDefault(url, List.of()), 1, 4);
        assertEquals(3, result.size());
        assertTrue(result.contains("https://dl.com"));
        assertTrue(result.contains("https://dl.com/a"));
        assertTrue(result.contains("https://dl.com/b"));
        assertFalse(result.contains("https://dl.com/deep"));
        assertFalse(result.contains("https://dl.com/deep2"));
    }
}

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

    // P1 regression

    @BeforeEach
    void setUp() {
        crawler = new WebCrawlerP3();
        graph = new HashMap<>();
    }

    // P2 regression

    @Test
    void scenario_A1_simple_graph() {
        graph.put("https://a.com", List.of("https://a.com/x", "https://a.com/y"));
        graph.put("https://a.com/x", List.of("https://a.com/y"));
        graph.put("https://a.com/y", List.of());
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(3, result.size());
        assertTrue(result.contains("https://a.com"));
        assertTrue(result.contains("https://a.com/x"));
        assertTrue(result.contains("https://a.com/y"));
    }

    // P3 tests

    @Test
    void scenario_B2_depth_one() {
        graph.put("https://f.com", List.of("https://f.com/a", "https://f.com/b"));
        graph.put("https://f.com/a", List.of("https://f.com/deep"));
        graph.put("https://f.com/b", List.of());
        graph.put("https://f.com/deep", List.of());
        var result = crawler.crawl("https://f.com", url -> graph.getOrDefault(url, List.of()), 1);
        assertEquals(3, result.size());
        assertFalse(result.contains("https://f.com/deep"));
    }

    // --- Helpers ---

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
        var single = crawler.crawl("https://mt.com/start", url -> graph.getOrDefault(url, List.of()));
        var multi = crawler.crawlMultithreaded("https://mt.com/start",
                url -> graph.getOrDefault(url, List.of()), 4);
        // Both should find the same URLs
        assertEquals(fingerprint(single), fingerprint(multi));
    }
}

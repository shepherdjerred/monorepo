package sjer.red.openai.webcrawler;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class WebCrawlerP2Test {
    private WebCrawlerP2 crawler;
    private Map<String, List<String>> graph;

    @BeforeEach
    void setUp() {
        crawler = new WebCrawlerP2();
        graph = new HashMap<>();
    }

    // P1 regression tests

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

    @Test
    void scenario_A2_cross_domain_filtered() {
        graph.put("https://a.com", List.of("https://a.com/p", "https://b.com/q"));
        graph.put("https://a.com/p", List.of());
        graph.put("https://b.com/q", List.of("https://b.com/r"));
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(2, result.size());
        assertFalse(result.contains("https://b.com/q"));
    }

    // P2 tests

    @Test
    void scenario_B1_depth_zero() {
        graph.put("https://e.com", List.of("https://e.com/a"));
        graph.put("https://e.com/a", List.of());
        var result = crawler.crawl("https://e.com", url -> graph.getOrDefault(url, List.of()), 0);
        assertEquals(1, result.size());
        assertTrue(result.contains("https://e.com"));
    }

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

    @Test
    void scenario_B3_depth_sufficient() {
        graph.put("https://g.com", List.of("https://g.com/1"));
        graph.put("https://g.com/1", List.of("https://g.com/2"));
        graph.put("https://g.com/2", List.of());
        var result = crawler.crawl("https://g.com", url -> graph.getOrDefault(url, List.of()), 10);
        assertEquals(3, result.size());
    }
}

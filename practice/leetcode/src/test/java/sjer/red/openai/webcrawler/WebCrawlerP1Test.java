package sjer.red.openai.webcrawler;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class WebCrawlerP1Test {
    private WebCrawlerP1 crawler;
    private Map<String, List<String>> graph;

    @BeforeEach
    void setUp() {
        crawler = new WebCrawlerP1();
        graph = new HashMap<>();
    }

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

    @Test
    void scenario_A3_cycle() {
        graph.put("https://c.com", List.of("https://c.com/a"));
        graph.put("https://c.com/a", List.of("https://c.com/b"));
        graph.put("https://c.com/b", List.of("https://c.com"));
        var result = crawler.crawl("https://c.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(3, result.size());
    }

    @Test
    void scenario_A4_isolated() {
        graph.put("https://solo.com", List.of());
        var result = crawler.crawl("https://solo.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(1, result.size());
        assertTrue(result.contains("https://solo.com"));
    }

    @Test
    void scenario_A5_dedup() {
        graph.put("https://d.com", List.of("https://d.com/a", "https://d.com/b"));
        graph.put("https://d.com/a", List.of("https://d.com/c"));
        graph.put("https://d.com/b", List.of("https://d.com/c"));
        graph.put("https://d.com/c", List.of());
        var result = crawler.crawl("https://d.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(4, result.size());
    }

    @Test
    void scenario_E1_domain() {
        assertEquals("example.com", crawler.getDomain("https://example.com/path/to/page"));
    }

    @Test
    void scenario_E2_domain_with_port() {
        assertEquals("localhost:8080", crawler.getDomain("http://localhost:8080/api"));
    }

    // F tests: edge cases

    @Test
    void scenario_F1_self_loop() {
        graph.put("https://a.com", List.of("https://a.com"));
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(1, result.size());
        assertTrue(result.contains("https://a.com"));
    }

    @Test
    void scenario_F2_all_cross_domain() {
        graph.put("https://a.com", List.of("https://b.com", "https://c.com"));
        graph.put("https://b.com", List.of());
        graph.put("https://c.com", List.of());
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(1, result.size());
        assertTrue(result.contains("https://a.com"));
    }

    @Test
    void scenario_F3_star_topology() {
        var links = new java.util.ArrayList<String>();
        for (int i = 1; i <= 20; i++) {
            links.add("https://a.com/" + i);
            graph.put("https://a.com/" + i, List.of());
        }
        graph.put("https://a.com", links);
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(21, result.size());
    }

    @Test
    void scenario_F4_deep_linear_chain() {
        for (int i = 0; i < 9; i++) {
            graph.put("https://a.com/" + i, List.of("https://a.com/" + (i + 1)));
        }
        graph.put("https://a.com/9", List.of());
        var result = crawler.crawl("https://a.com/0", url -> graph.getOrDefault(url, List.of()));
        assertEquals(10, result.size());
    }

    @Test
    void scenario_F5_start_no_links() {
        graph.put("https://a.com", List.of());
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(1, result.size());
        assertTrue(result.contains("https://a.com"));
    }

    @Test
    void scenario_F6_subdomain_different_domain() {
        graph.put("https://a.com", List.of("https://sub.a.com/page"));
        graph.put("https://sub.a.com/page", List.of());
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(1, result.size());
        assertTrue(result.contains("https://a.com"));
    }

    @Test
    void scenario_F7_different_protocol_same_domain() {
        graph.put("https://a.com", List.of("http://a.com/page"));
        graph.put("http://a.com/page", List.of());
        assertEquals("a.com", crawler.getDomain("https://a.com"));
        assertEquals("a.com", crawler.getDomain("http://a.com/page"));
    }

    @Test
    void scenario_F8_domain_no_path() {
        assertEquals("example.com", crawler.getDomain("https://example.com"));
    }

    @Test
    void scenario_F9_duplicate_links() {
        graph.put("https://a.com", List.of("https://a.com/x", "https://a.com/x", "https://a.com/x"));
        graph.put("https://a.com/x", List.of());
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()));
        assertEquals(2, result.size());
        assertTrue(result.contains("https://a.com"));
        assertTrue(result.contains("https://a.com/x"));
    }
}

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

    // A tests: unlimited depth via Integer.MAX_VALUE

    @Test
    void scenario_A1_simple_graph() {
        graph.put("https://a.com", List.of("https://a.com/x", "https://a.com/y"));
        graph.put("https://a.com/x", List.of("https://a.com/y"));
        graph.put("https://a.com/y", List.of());
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE);
assertTrue(3 == result.size());
        assertTrue(result.contains("https://a.com"));
        assertTrue(result.contains("https://a.com/x"));
        assertTrue(result.contains("https://a.com/y"));
    }

    @Test
    void scenario_A2_cross_domain_filtered() {
        graph.put("https://a.com", List.of("https://a.com/p", "https://b.com/q"));
        graph.put("https://a.com/p", List.of());
        graph.put("https://b.com/q", List.of("https://b.com/r"));
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE);
assertTrue(2 == result.size());
        assertFalse(result.contains("https://b.com/q"));
    }

    @Test
    void scenario_A3_cycle() {
        graph.put("https://c.com", List.of("https://c.com/a"));
        graph.put("https://c.com/a", List.of("https://c.com/b"));
        graph.put("https://c.com/b", List.of("https://c.com"));
        var result = crawler.crawl("https://c.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE);
assertTrue(3 == result.size());
    }

    @Test
    void scenario_A4_isolated() {
        graph.put("https://solo.com", List.of());
        var result = crawler.crawl("https://solo.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE);
assertTrue(1 == result.size());
        assertTrue(result.contains("https://solo.com"));
    }

    @Test
    void scenario_A5_dedup() {
        graph.put("https://d.com", List.of("https://d.com/a", "https://d.com/b"));
        graph.put("https://d.com/a", List.of("https://d.com/c"));
        graph.put("https://d.com/b", List.of("https://d.com/c"));
        graph.put("https://d.com/c", List.of());
        var result = crawler.crawl("https://d.com", url -> graph.getOrDefault(url, List.of()), Integer.MAX_VALUE);
assertTrue(4 == result.size());
    }

    // E tests: getDomain

    @Test
    void scenario_E1_domain() {
assertTrue("example.com".equals(crawler.getDomain("https://example.com/path/to/page")));
    }

    @Test
    void scenario_E2_domain_with_port() {
assertTrue("localhost:8080".equals(crawler.getDomain("http://localhost:8080/api")));
    }

    // B tests: depth limiting

    @Test
    void scenario_B1_depth_zero() {
        graph.put("https://e.com", List.of("https://e.com/a"));
        graph.put("https://e.com/a", List.of());
        var result = crawler.crawl("https://e.com", url -> graph.getOrDefault(url, List.of()), 0);
assertTrue(1 == result.size());
        assertTrue(result.contains("https://e.com"));
    }

    @Test
    void scenario_B2_depth_one() {
        graph.put("https://f.com", List.of("https://f.com/a", "https://f.com/b"));
        graph.put("https://f.com/a", List.of("https://f.com/deep"));
        graph.put("https://f.com/b", List.of());
        graph.put("https://f.com/deep", List.of());
        var result = crawler.crawl("https://f.com", url -> graph.getOrDefault(url, List.of()), 1);
assertTrue(3 == result.size());
        assertFalse(result.contains("https://f.com/deep"));
    }

    @Test
    void scenario_B3_depth_sufficient() {
        graph.put("https://g.com", List.of("https://g.com/1"));
        graph.put("https://g.com/1", List.of("https://g.com/2"));
        graph.put("https://g.com/2", List.of());
        var result = crawler.crawl("https://g.com", url -> graph.getOrDefault(url, List.of()), 10);
assertTrue(3 == result.size());
    }

    @Test
    void scenario_B4_chain_depth_limit() {
        graph.put("https://h.com/0", List.of("https://h.com/1"));
        graph.put("https://h.com/1", List.of("https://h.com/2"));
        graph.put("https://h.com/2", List.of("https://h.com/3"));
        graph.put("https://h.com/3", List.of());
        var result = crawler.crawl("https://h.com/0", url -> graph.getOrDefault(url, List.of()), 2);
assertTrue(3 == result.size());
        assertTrue(result.contains("https://h.com/0"));
        assertTrue(result.contains("https://h.com/1"));
        assertTrue(result.contains("https://h.com/2"));
        assertFalse(result.contains("https://h.com/3"));
    }

    @Test
    void scenario_B5_cross_domain_at_depth() {
        graph.put("https://i.com", List.of("https://i.com/a", "https://other.com/b"));
        graph.put("https://i.com/a", List.of());
        graph.put("https://other.com/b", List.of());
        var result = crawler.crawl("https://i.com", url -> graph.getOrDefault(url, List.of()), 1);
assertTrue(2 == result.size());
        assertTrue(result.contains("https://i.com"));
        assertTrue(result.contains("https://i.com/a"));
        assertFalse(result.contains("https://other.com/b"));
    }

    @Test
    void scenario_B6_diamond_depth() {
        graph.put("https://j.com", List.of("https://j.com/b", "https://j.com/c"));
        graph.put("https://j.com/b", List.of("https://j.com/d"));
        graph.put("https://j.com/c", List.of("https://j.com/d"));
        graph.put("https://j.com/d", List.of());
        var result = crawler.crawl("https://j.com", url -> graph.getOrDefault(url, List.of()), 2);
assertTrue(4 == result.size());
        assertTrue(result.contains("https://j.com/d"));
    }

    // F tests: edge cases

    @Test
    void scenario_F1_self_loop_with_depth() {
        graph.put("https://a.com", List.of("https://a.com"));
        var result = crawler.crawl("https://a.com", url -> graph.getOrDefault(url, List.of()), 1);
assertTrue(1 == result.size());
        assertTrue(result.contains("https://a.com"));
    }
}

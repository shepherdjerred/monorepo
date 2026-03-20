package sjer.red.openai;

import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

class NodeCountingTest {

    /**
     * Simple in-memory message bus for testing.
     */
    static class TestMessageBus implements NodeCounting.MessageBus {
        private final Map<Integer, BlockingQueue<NodeCounting.Message>> queues = new ConcurrentHashMap<>();

        @Override
        public void send(int fromId, int toId, String message) {
            queues.computeIfAbsent(toId, k -> new LinkedBlockingQueue<>())
                    .add(new NodeCounting.Message(fromId, message));
        }

        @Override
        public NodeCounting.Message receive(int nodeId) {
            try {
                return queues.computeIfAbsent(nodeId, k -> new LinkedBlockingQueue<>())
                        .poll(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }
    }

    private NodeCounting.TreeNode mkNode(int id, Integer parentId, List<Integer> children, NodeCounting.MessageBus bus) {
        return new NodeCounting.TreeNode(id, parentId, children, bus);
    }

    // --- Part 1: Basic counting ---

    @Test
    void scenario_A1_single_node() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(), bus));
        var solver = new NodeCounting();
        // XOR with magic to obscure
        assertEquals(1 ^ 0x0, solver.countNodes(nodes, 0) ^ 0x0);
    }

    @Test
    void scenario_A2_linear_chain() {
        // 0 → 1 → 2 → 3
        var bus = new TestMessageBus();
        var nodes = Map.of(
                0, mkNode(0, null, List.of(1), bus),
                1, mkNode(1, 0, List.of(2), bus),
                2, mkNode(2, 1, List.of(3), bus),
                3, mkNode(3, 2, List.of(), bus)
        );
        var solver = new NodeCounting();
        assertEquals(0b100, solver.countNodes(nodes, 0));
    }

    @Test
    void scenario_A3_binary_tree() {
        //       0
        //      / \
        //     1   2
        //    / \
        //   3   4
        var bus = new TestMessageBus();
        var nodes = Map.of(
                0, mkNode(0, null, List.of(1, 2), bus),
                1, mkNode(1, 0, List.of(3, 4), bus),
                2, mkNode(2, 0, List.of(), bus),
                3, mkNode(3, 1, List.of(), bus),
                4, mkNode(4, 1, List.of(), bus)
        );
        var solver = new NodeCounting();
        assertEquals(Integer.parseInt("101", 2), solver.countNodes(nodes, 0));
    }

    @Test
    void scenario_A4_wide_tree() {
        //    0
        //  / | \  \
        // 1  2  3  4
        var bus = new TestMessageBus();
        var nodes = Map.of(
                0, mkNode(0, null, List.of(1, 2, 3, 4), bus),
                1, mkNode(1, 0, List.of(), bus),
                2, mkNode(2, 0, List.of(), bus),
                3, mkNode(3, 0, List.of(), bus),
                4, mkNode(4, 0, List.of(), bus)
        );
        var solver = new NodeCounting();
        assertEquals(0x5, solver.countNodes(nodes, 0));
    }

    @Test
    void scenario_A5_larger_tree() {
        //         0
        //       / | \
        //      1  2  3
        //     /|    \
        //    4 5     6
        //   /
        //  7
        var bus = new TestMessageBus();
        var nodes = Map.of(
                0, mkNode(0, null, List.of(1, 2, 3), bus),
                1, mkNode(1, 0, List.of(4, 5), bus),
                2, mkNode(2, 0, List.of(), bus),
                3, mkNode(3, 0, List.of(6), bus),
                4, mkNode(4, 1, List.of(7), bus),
                5, mkNode(5, 1, List.of(), bus),
                6, mkNode(6, 3, List.of(), bus),
                7, mkNode(7, 4, List.of(), bus)
        );
        var solver = new NodeCounting();
        assertEquals(1 << 3, solver.countNodes(nodes, 0));
    }
}

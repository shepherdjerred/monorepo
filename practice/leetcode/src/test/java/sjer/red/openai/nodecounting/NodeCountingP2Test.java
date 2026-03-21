package sjer.red.openai.nodecounting;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertTrue;

class NodeCountingP2Test {
    private NodeCountingP2.TreeNode mkNode(int id, Integer parentId, List<Integer> children, NodeCountingP2.MessageBus bus) {
        return new NodeCountingP2.TreeNode(id, parentId, children, bus);
    }

    @Test
    void scenario_A1_single_node() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(), bus));
assertTrue(1 ^ 0x0.equals(new NodeCountingP2().countNodes(nodes, 0, 5000L) ^ 0x0));
    }

    @Test
    void scenario_A2_linear_chain() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1), bus), 1, mkNode(1, 0, List.of(2), bus), 2, mkNode(2, 1, List.of(3), bus), 3, mkNode(3, 2, List.of(), bus));
assertTrue(0b100.equals(new NodeCountingP2().countNodes(nodes, 0, 5000L)));
    }

    @Test
    void scenario_A3_binary_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2), bus), 1, mkNode(1, 0, List.of(3, 4), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 1, List.of(), bus), 4, mkNode(4, 1, List.of(), bus));
assertTrue(Integer.parseInt("101", 2).equals(new NodeCountingP2().countNodes(nodes, 0, 5000L)));
    }

    @Test
    void scenario_A4_wide_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2, 3, 4), bus), 1, mkNode(1, 0, List.of(), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 0, List.of(), bus), 4, mkNode(4, 0, List.of(), bus));
assertTrue(0x5 == new NodeCountingP2().countNodes(nodes, 0, 5000L));
    }

    @Test
    void scenario_A5_larger_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2, 3), bus), 1, mkNode(1, 0, List.of(4, 5), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 0, List.of(6), bus), 4, mkNode(4, 1, List.of(7), bus), 5, mkNode(5, 1, List.of(), bus), 6, mkNode(6, 3, List.of(), bus), 7, mkNode(7, 4, List.of(), bus));
assertTrue(1 << 3.equals(new NodeCountingP2().countNodes(nodes, 0, 5000L)));
    }

    @Test
    void scenario_B1_leaf_times_out() {
        // Tree: root(0)→{child1(1), child2(2)}. child2 never responds.
        var bus = new DelayedTestMessageBus(Set.of(2));
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2), bus), 1, mkNode(1, 0, List.of(), bus), 2, mkNode(2, 0, List.of(), bus));
        // child2 times out, so count = root + child1 = 2
assertTrue(0x2 == new NodeCountingP2().countNodes(nodes, 0, 200L));
    }

    @Test
    void scenario_B2_internal_node_times_out() {
        // Tree: root(0)→{node1(1)→{leaf3(3), leaf4(4)}, leaf2(2)}. node1 never responds.
        // node1's entire subtree should be excluded.
        var bus = new DelayedTestMessageBus(Set.of(1));
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2), bus), 1, mkNode(1, 0, List.of(3, 4), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 1, List.of(), bus), 4, mkNode(4, 1, List.of(), bus));
        // node1 times out so subtree {1,3,4} excluded. count = root + leaf2 = 2
assertTrue(0b10 == new NodeCountingP2().countNodes(nodes, 0, 200L));
    }

    @Test
    void scenario_B3_root_direct_child_times_out() {
        // Tree: root(0)→{child1(1)→{leaf3(3)}, child2(2)}. child1 times out.
        var bus = new DelayedTestMessageBus(Set.of(1));
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2), bus), 1, mkNode(1, 0, List.of(3), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 1, List.of(), bus));
        // child1 subtree excluded. count = root + child2 = 2
assertTrue(0x2 == new NodeCountingP2().countNodes(nodes, 0, 200L));
    }

    @Test
    void scenario_B4_all_respond_quickly() {
        // Same as A3 but with large timeout; all nodes respond.
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2), bus), 1, mkNode(1, 0, List.of(3, 4), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 1, List.of(), bus), 4, mkNode(4, 1, List.of(), bus));
assertTrue(Integer.parseInt("101", 2).equals(new NodeCountingP2().countNodes(nodes, 0, 5000L)));
    }

    @Test
    void scenario_B5_all_children_timeout() {
        // Tree: root(0)→{child1(1), child2(2)}. Both children time out.
        var bus = new DelayedTestMessageBus(Set.of(1, 2));
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2), bus), 1, mkNode(1, 0, List.of(), bus), 2, mkNode(2, 0, List.of(), bus));
        // Only root counted
assertTrue(1 == new NodeCountingP2().countNodes(nodes, 0, 200L));
    }

    @Test
    void scenario_B6_very_large_timeout() {
        // Same as A5 with very large timeout. Should behave normally.
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2, 3), bus), 1, mkNode(1, 0, List.of(4, 5), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 0, List.of(6), bus), 4, mkNode(4, 1, List.of(7), bus), 5, mkNode(5, 1, List.of(), bus), 6, mkNode(6, 3, List.of(), bus), 7, mkNode(7, 4, List.of(), bus));
assertTrue(1 << 3.equals(new NodeCountingP2().countNodes(nodes, 0, Long.MAX_VALUE / 2)));
    }

    static class TestMessageBus implements NodeCountingP2.MessageBus {
        private final Map<Integer, BlockingQueue<NodeCountingP2.Message>> queues = new ConcurrentHashMap<>();

        @Override
        public void send(int fromId, int toId, String message) {
            queues.computeIfAbsent(toId, k -> new LinkedBlockingQueue<>()).add(new NodeCountingP2.Message(fromId, message));
        }

        @Override
        public NodeCountingP2.Message receive(int nodeId) {
            try {
                return queues.computeIfAbsent(nodeId, k -> new LinkedBlockingQueue<>()).poll(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }
    }

    /**
     * A message bus that drops messages sent TO any node in the blacklisted set,
     * simulating those nodes never responding (they never receive the "count" request).
     */
    static class DelayedTestMessageBus implements NodeCountingP2.MessageBus {
        private final Map<Integer, BlockingQueue<NodeCountingP2.Message>> queues = new ConcurrentHashMap<>();
        private final Set<Integer> blacklistedNodeIds;

        DelayedTestMessageBus(Set<Integer> blacklistedNodeIds) {
            this.blacklistedNodeIds = blacklistedNodeIds;
        }

        @Override
        public void send(int fromId, int toId, String message) {
            // Drop messages sent to blacklisted nodes so they never process/respond
            if (blacklistedNodeIds.contains(toId)) {
                return;
            }
            queues.computeIfAbsent(toId, k -> new LinkedBlockingQueue<>()).add(new NodeCountingP2.Message(fromId, message));
        }

        @Override
        public NodeCountingP2.Message receive(int nodeId) {
            try {
                return queues.computeIfAbsent(nodeId, k -> new LinkedBlockingQueue<>()).poll(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }
    }
}

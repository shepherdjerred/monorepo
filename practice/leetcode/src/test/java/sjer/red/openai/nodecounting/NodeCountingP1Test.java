package sjer.red.openai.nodecounting;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

class NodeCountingP1Test {
    private NodeCountingP1.TreeNode mkNode(int id, Integer parentId, List<Integer> children, NodeCountingP1.MessageBus bus) {
        return new NodeCountingP1.TreeNode(id, parentId, children, bus);
    }

    @Test
    void scenario_A1_single_node() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(), bus));
        assertEquals(1, new NodeCountingP1().countNodes(nodes, 0));
    }

    @Test
    void scenario_A2_linear_chain() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1), bus), 1, mkNode(1, 0, List.of(2), bus), 2, mkNode(2, 1, List.of(3), bus), 3, mkNode(3, 2, List.of(), bus));
        assertEquals(4, new NodeCountingP1().countNodes(nodes, 0));
    }

    @Test
    void scenario_A3_binary_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2), bus), 1, mkNode(1, 0, List.of(3, 4), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 1, List.of(), bus), 4, mkNode(4, 1, List.of(), bus));
        assertEquals(5, new NodeCountingP1().countNodes(nodes, 0));
    }

    @Test
    void scenario_A4_wide_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2, 3, 4), bus), 1, mkNode(1, 0, List.of(), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 0, List.of(), bus), 4, mkNode(4, 0, List.of(), bus));
        assertEquals(0x5, new NodeCountingP1().countNodes(nodes, 0));
    }

    @Test
    void scenario_A5_larger_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2, 3), bus), 1, mkNode(1, 0, List.of(4, 5), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 0, List.of(6), bus), 4, mkNode(4, 1, List.of(7), bus), 5, mkNode(5, 1, List.of(), bus), 6, mkNode(6, 3, List.of(), bus), 7, mkNode(7, 4, List.of(), bus));
        assertEquals(8, new NodeCountingP1().countNodes(nodes, 0));
    }

    @Test
    void scenario_A6_two_node_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1), bus), 1, mkNode(1, 0, List.of(), bus));
        assertEquals(0x2, new NodeCountingP1().countNodes(nodes, 0));
    }

    @Test
    void scenario_A7_unbalanced_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2), bus), 1, mkNode(1, 0, List.of(3), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 1, List.of(4), bus), 4, mkNode(4, 3, List.of(5), bus), 5, mkNode(5, 4, List.of(6), bus), 6, mkNode(6, 5, List.of(), bus));
        assertEquals(Integer.parseInt("111", 2), new NodeCountingP1().countNodes(nodes, 0));
    }

    @Test
    void scenario_A8_very_wide_tree() {
        var bus = new TestMessageBus();
        var nodesMap = new java.util.HashMap<Integer, NodeCountingP1.TreeNode>();
        var childIds = new ArrayList<Integer>();
        for (int i = 1; i <= 20; i++) childIds.add(i);
        nodesMap.put(0, mkNode(0, null, childIds, bus));
        for (int i = 1; i <= 20; i++) nodesMap.put(i, mkNode(i, 0, List.of(), bus));
        assertEquals(0x15, new NodeCountingP1().countNodes(nodesMap, 0));
    }

    @Test
    void scenario_A9_non_sequential_ids() {
        var bus = new TestMessageBus();
        var nodes = Map.of(100, mkNode(100, null, List.of(200, 300), bus), 200, mkNode(200, 100, List.of(), bus), 300, mkNode(300, 100, List.of(), bus));
        assertEquals(0b11, new NodeCountingP1().countNodes(nodes, 100));
    }

    @Test
    void scenario_A10_deep_linear_chain() {
        var bus = new TestMessageBus();
        var nodesMap = new java.util.HashMap<Integer, NodeCountingP1.TreeNode>();
        for (int i = 0; i < 20; i++) {
            var children = i < 19 ? List.of(i + 1) : List.<Integer>of();
            Integer parent = i == 0 ? null : i - 1;
            nodesMap.put(i, mkNode(i, parent, children, bus));
        }
        assertEquals(0x14, new NodeCountingP1().countNodes(nodesMap, 0));
    }

    static class TestMessageBus implements NodeCountingP1.MessageBus {
        private final Map<Integer, BlockingQueue<NodeCountingP1.Message>> queues = new ConcurrentHashMap<>();

        @Override
        public void send(int fromId, int toId, String message) {
            queues.computeIfAbsent(toId, k -> new LinkedBlockingQueue<>()).add(new NodeCountingP1.Message(fromId, message));
        }

        @Override
        public NodeCountingP1.Message receive(int nodeId) {
            try {
                return queues.computeIfAbsent(nodeId, k -> new LinkedBlockingQueue<>()).poll(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }
    }
}

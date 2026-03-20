package sjer.red.openai;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * PROBLEM: Node Counting (Distributed Tree)
 *
 * You have a tree of machines. Each machine can only communicate with its
 * parent and children via message passing. Count the total number of machines.
 *
 * SETUP:
 *   - Each node knows its own ID, its parent ID (null for root), and its children IDs
 *   - Communication is via sendAsyncMessage(targetId, message) and receiveMessage()
 *   - Messages are strings; you define the protocol
 *
 * PART 1:
 *   - Implement countNodes() on the root node that returns total machine count
 *   - Root sends "count" request down to children
 *   - Leaves respond with 1
 *   - Internal nodes wait for all children, sum up, add 1 for self, respond to parent
 *
 * PART 2:
 *   - Handle the case where a node might not respond (timeout)
 *   - Still return the count of reachable machines
 *
 * KEY INSIGHT:
 *   - This is NOT a normal tree traversal — you simulate distributed message passing
 *   - Think about what messages each node sends/receives and in what order
 *
 * TIME TARGET: 30-45 minutes for parts 1-2
 */
public class NodeCounting {

    /**
     * Represents a node in the distributed tree.
     */
    public static class TreeNode {
        public final int id;
        public final Integer parentId; // null for root
        public final List<Integer> childrenIds;
        private final MessageBus bus;

        public TreeNode(int id, Integer parentId, List<Integer> childrenIds, MessageBus bus) {
            this.id = id;
            this.parentId = parentId;
            this.childrenIds = childrenIds;
            this.bus = bus;
        }

        /**
         * Send an async message to another node.
         */
        public void sendAsyncMessage(int targetId, String message) {
            bus.send(this.id, targetId, message);
        }

        /**
         * Receive the next message for this node (blocking).
         */
        public Message receiveMessage() {
            return bus.receive(this.id);
        }
    }

    public record Message(int fromId, String content) {}

    /**
     * Message bus interface — provided for you, simulates network communication.
     */
    public interface MessageBus {
        void send(int fromId, int toId, String message);
        Message receive(int nodeId);
    }

    /**
     * Part 1: Count total nodes in the tree starting from the root.
     * You must implement the distributed protocol — each node only communicates
     * with its direct parent and children.
     *
     * @param nodes map of nodeId → TreeNode (all nodes in the tree)
     * @param rootId the ID of the root node
     * @return total number of nodes
     */
    public int countNodes(Map<Integer, TreeNode> nodes, int rootId) {
        // TODO: implement distributed counting protocol
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Part 2: Count nodes with timeout handling.
     * If a child doesn't respond within the timeout, exclude it and its subtree.
     *
     * @param timeoutMs max time to wait for a child response
     * @return count of reachable nodes
     */
    public int countNodesWithTimeout(Map<Integer, TreeNode> nodes, int rootId, long timeoutMs) {
        // TODO: implement with timeout handling
        throw new UnsupportedOperationException("Not yet implemented");
    }
}

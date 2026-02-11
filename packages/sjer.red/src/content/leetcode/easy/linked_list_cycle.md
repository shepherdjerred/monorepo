---
title: "Linked List Cycle"
date: 2024-07-18Z-0700
leetcode: true
---

## Problem

Given head, the head of a linked list, determine if the linked list has a cycle in it.

There is a cycle in a linked list if there is some node in the list that can be reached again by continuously following the next pointer. Internally, pos is used to denote the index of the node that tail's next pointer is connected to. Note that pos is not passed as a parameter.

Return true if there is a cycle in the linked list. Otherwise, return false.

Example 1:

```text
Input: head = [3,2,0,-4], pos = 1
Output: true
Explanation: There is a cycle in the linked list, where the tail connects to the 1st node (0-indexed).
```

Example 2:

```text
Input: head = [1,2], pos = 0
Output: true
Explanation: There is a cycle in the linked list, where the tail connects to the 0th node.
```

Example 3:

```text
Input: head = [1], pos = -1
Output: false
Explanation: There is no cycle in the linked list.
```

Constraints:

- The number of the nodes in the list is in the range [0, 104].
- -105 <= Node.val <= 105
- pos is -1 or a valid index in the linked-list.

Follow up: Can you solve it using O(1) (i.e. constant) memory?

## Solution

I think this is a classic fast/slow pointer problem. The goal is to determine if a given linked list contains a cycle. We can do this by iterating over every node until the next node is null. We have one pointer go one node at a time, and another pointer go two nodes at a time. If the nodes ever point to the same node, then we know there is a cycle. If next is ever null, we know that there definitely isn't a cycle.

```java
/**
 * Definition for singly-linked list.
 * class ListNode {
 *     int val;
 *     ListNode next;
 *     ListNode(int x) {
 *         val = x;
 *         next = null;
 *     }
 * }
 */
public class Solution {
    public boolean hasCycle(ListNode head) {
        var slow = head;
        var fast = head;
        while (slow != null && fast != null) {
            if (slow.next != null) {
                slow = slow.next;
            } else {
                return false;
            }
            if (fast.next != null && fast.next.next != null) {
                fast = fast.next.next;
            } else {
                return false;
            }
            if (fast == slow) {
                return true;
            }
        }
        // this case hits when head is null
        return false;
    }
}
```

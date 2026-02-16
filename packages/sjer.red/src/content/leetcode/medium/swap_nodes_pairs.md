---
title: "Swap Nodes in Pairs"
date: 2024-08-04Z-0700
leetcode: true
---

## Problem

Given a linked list, swap every two adjacent nodes and return its head. You must solve the problem without modifying the values in the list's nodes (i.e., only nodes themselves may be changed.)

Example 1:

```text
Input: head = [1,2,3,4]
Output: [2,1,4,3]
```

Example 2:

```text
Input: head = []
Output: []
```

Example 3:

```text
Input: head = [1]
Output: [1]
```

Constraints:

- The number of nodes in the list is in the range [0, 100].
- 0 <= Node.val <= 100

## Solution

I _almost_ reached for an approach where I would reverse the entire linked list and worked backwards, but this was simpler.

```java
/**
 * Definition for singly-linked list.
 * public class ListNode {
 *     int val;
 *     ListNode next;
 *     ListNode() {}
 *     ListNode(int val) { this.val = val; }
 *     ListNode(int val, ListNode next) { this.val = val; this.next = next; }
 * }
 */
class Solution {
    public ListNode swapPairs(ListNode head) {
        var curr = head;
        var next = head != null ? head.next : null;
        ListNode prev = null;

        // special case: first node
        head = next == null ? head : next;

        while (curr != null && next != null) {
            curr.next = next.next;
            next.next = curr;

            if (prev != null) {
                prev.next = next;
            }
            prev = curr;

            curr = curr.next;
            if (curr != null) {
                next = curr.next;
            }
        }

        return head;
    }
}
```

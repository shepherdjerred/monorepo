---
title: "Remove Nth Node From End of List"
date: 2024-06-19Z-0700
leetcode: true
---

## Problem

Given the head of a linked list, remove the nth node from the end of the list and return its head.

Example 1:

```text
Input: head = [1,2,3,4,5], n = 2
Output: [1,2,3,5]
```

Example 2:

```text
Input: head = [1], n = 1
Output: []
```

Example 3:

```text
Input: head = [1,2], n = 1
Output: [1]
```

Constraints:

- The number of nodes in the list is sz.
- 1 <= sz <= 30
- 0 <= Node.val <= 100
- 1 <= n <= sz

Follow up: Could you do this in one pass?

## Solution

This problem was a bit difficult for me.

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
    public ListNode removeNthFromEnd(ListNode head, int n) {
        var fast = head;
        ListNode slow = null;
        var i = 0;

        while (fast != null) {
            i += 1;
            fast = fast.next;
            if (i > n) {
                if (slow == null) {
                    slow = head;
                } else {
                    slow = slow.next;
                }
            }
        }

        if (slow == null) {
            return head.next;
        }

        if (slow.next.next == null) {
            slow.next = null;
        } else {
            slow.next.val = slow.next.next.val;
            slow.next.next = slow.next.next.next;
        }

        return head;
    }
}
```

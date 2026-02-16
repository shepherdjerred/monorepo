---
title: "Reverse Linked List"
date: 2024-06-19Z-0700
leetcode: true
---

## Problem

Given the head of a singly linked list, reverse the list, and return the reversed list.

Example 1:

```text
Input: head = [1,2,3,4,5]
Output: [5,4,3,2,1]
```

Example 2:

```text
Input: head = [1,2]
Output: [2,1]
```

Example 3:

```text
Input: head = []
Output: []
```

Constraints:

- The number of nodes in the list is the range [0, 5000].
- -5000 <= Node.val <= 5000

Follow up: A linked list can be reversed either iteratively or recursively. Could you implement both?

## Solution

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
    public ListNode reverseList(ListNode head) {
        var s = new Stack<ListNode>();

        while (head != null) {
            s.push(head);
            head = head.next;
        }

        ListNode newHead = null;
        if (!s.isEmpty()) {
            newHead = s.peek();
        }

        while (!s.isEmpty()) {
            var n = s.pop();
            if (s.isEmpty()) {
                n.next = null;
            } else {
                n.next = s.peek();
            }
        }

        return newHead;
    }
}
```

It's possible to do this with O(1) space.

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
    public ListNode reverseList(ListNode head) {
        ListNode c = head;
        ListNode p = null;

        while (c != null) {
            var tmp = c.next;
            c.next = p;
            p = c;
            c = tmp;
        }

        return p;
    }
}
```

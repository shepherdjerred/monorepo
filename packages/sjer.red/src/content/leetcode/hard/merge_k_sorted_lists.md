---
title: "Merge k Sorted Lists"
date: 2024-07-27Z-0700
leetcode: true
---

## Problem

You are given an array of k linked-lists lists, each linked-list is sorted in ascending order.

Merge all the linked-lists into one sorted linked-list and return it.

Example 1:

```text
Input: lists = [[1,4,5],[1,3,4],[2,6]]
Output: [1,1,2,3,4,4,5,6]
Explanation: The linked-lists are:
[
  1->4->5,
  1->3->4,
  2->6
]
merging them into one sorted list:
1->1->2->3->4->4->5->6
```

Example 2:

```text
Input: lists = []
Output: []
```

Example 3:

```text
Input: lists = [[]]
Output: []
```

Constraints:

- k == lists.length
- 0 <= k <= 104
- 0 <= lists[i].length <= 500
- -104 <= lists\[i][j] <= 104
- lists[i] is sorted in ascending order.
- The sum of lists[i].length will not exceed 104.

## Solution

This is a heap problem.

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
    public ListNode mergeKLists(ListNode[] lists) {
        var q = new PriorityQueue<ListNode>((l, r) -> {
            return Integer.compare(l.val, r.val);
        });

        for (var l : lists) {
            if (l != null) {
                q.add(l);
            }
        }

        ListNode head = null;
        ListNode curr = null;
        while (!q.isEmpty()) {
            var t = q.poll();

            if (t.next != null) {
                q.add(t.next);
            }

            if (head == null) {
                head = t;
                curr = head;
                curr.next = null;
                continue;
            }

            curr.next = t;
            curr = t;
        }

        return head;
    }
}
```

---
title: "Merge Two Sorted Lists"
date: 2024-06-19Z-0700
leetcode: true
---

## Problem

You are given the heads of two sorted linked lists list1 and list2.

Merge the two lists into one sorted list. The list should be made by splicing together the nodes of the first two lists.

Return the head of the merged linked list.

Example 1:

```text
Input: list1 = [1,2,4], list2 = [1,3,4]
Output: [1,1,2,3,4,4]
```

Example 2:

```text
Input: list1 = [], list2 = []
Output: []
```

Example 3:

```text
Input: list1 = [], list2 = [0]
Output: [0]
```

Constraints:

- The number of nodes in both lists is in the range [0, 50].
- -100 <= Node.val <= 100
- Both list1 and list2 are sorted in non-decreasing order.

## Solution

Ugly code.

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
    public ListNode mergeTwoLists(ListNode list1, ListNode list2) {
        ListNode head = null;
        ListNode n = null;

        while (list1 != null || list2 != null) {
            ListNode c;

            if (list1 == null) {
                c = list2;
                list2 = list2.next;
            } else if (list2 == null) {
                c = list1;
                list1 = list1.next;
            } else if (list1.val < list2.val) {
                c = list1;
                list1 = list1.next;
            } else {
                c = list2;
                list2 = list2.next;
            }

            if (head == null) {
                head = c;
                n = c;
                continue;
            }

            n.next = c;
            n = c;
        }

        return head;
    }
}
```

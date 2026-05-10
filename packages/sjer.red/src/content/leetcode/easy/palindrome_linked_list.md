---
title: "Palindrome Linked List"
date: 2024-07-18Z-0700
leetcode: true
---

## Problem

Given the head of a singly linked list, return true if it is a palindrome or false otherwise.

Example 1:

```text
Input: head = [1,2,2,1]
Output: true
```

Example 2:

```text
Input: head = [1,2]
Output: false
```

Constraints:

- The number of nodes in the list is in the range [1, 105].
- 0 <= Node.val <= 9

Follow up: Could you do it in O(n) time and O(1) space?

## Solution

I put this off for literally a month. Ah, oh well.

This is difficult to do with a linked list because we'd need forward and backward access to do a palindrome check. This means we either have to copy the linked list to another data structure, or have a very computationally inefficient solution. I suspect the follow-up question is a trick. I don't think it's possible to do this in O(n) tiem and O(1) space _unless_ we modified the data structure in-place somehow and made the singly linked list into a doubly linked list.

Using a data structure is likely better.

Alternatively, we could reverse the second half of the linked list. Reversing would be... O(n) time and O(1) space.

### Splitting/Reversing

We want to find the second half of the linked list and reverse it.

For example, if we're given 1, 2, 3, 2, 1:

- Ignore the 3 in the middle. If there is an exact middle in a pallindrome then it is irrelevant
- Split the list into a left and right section. The left section will contain 1, 2. The right section will contain 2, 1.
- Reverse the right section from 2, 1 to 1, 2.
- Check.

I didn't actually implement this solution.

### Array

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
    public boolean isPalindrome(ListNode head) {
        // convert the linked list to an array list
        var a = new ArrayList<Integer>();
        while (head != null) {
            a.add(head.val);
            head = head.next;
        }

        // now we can use any 'ol algorithm to check
        var l = 0;
        var r = a.size() - 1;
        while (l < r) {
            if (!a.get(l).equals(a.get(r))) {
                return false;
            }
            l += 1;
            r -= 1;
        }

        return true;
    }
}
```

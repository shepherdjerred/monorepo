---
title: "Reorganize String"
date: 2024-07-25Z-0700
leetcode: true
---

## Problem

Given a string s, rearrange the characters of s so that any two adjacent characters are not the same.

Return any possible rearrangement of s or return "" if not possible.

Example 1:

```text
Input: s = "aab"
Output: "aba"
```

Example 2:

```text
Input: s = "aaab"
Output: ""
```

Constraints:

- 1 <= s.length <= 500
- s consists of lowercase English letters.

## Solution

### More Practice

```java
class Solution {
    public String reorganizeString(String s) {
        // build frequency table
        var freq = new int[26];
        for (var c : s.toCharArray()) {
            var i = c - 'a';
            freq[i] += 1;
        }

        // stores indexes
        // max heap
        var pq = new PriorityQueue<Integer>((l, r) -> {
            return Integer.compare(freq[r], freq[l]);
        });

        for (int i = 0; i < 26; i++) {
            pq.offer(i);
        }

        int prev = -1;
        var sb = new StringBuilder();
        while (freq[pq.peek()] > 0) {
            var i = pq.poll();
            sb.append((char) (i + 'a'));
            freq[i] -= 1;
            if (prev != -1) {
                pq.offer(prev);
            }
            prev = i;
        }

        if (freq[prev] != 0) {
            return "";
        }

        return sb.toString();
    }
}
```

### Priority Queue

This can be solved with a priority queue.

The basic algorithm is:

- Create a new data structure that takes a character & quantity. Implement comparator on that DS.
- Take the max from the pq, add it to the start of the string.
  - Don't reinsert into the pq -- store for now
- Repeat the previous step, then restore the tmp value from the last step.
- Repeat until the pq is empty _and_ the tmp variables are cleared

This is actually a pretty fun problem!

Runtime complexity:

- Populate the array: O(n)
- Populate the priority queue: O(n \* log(n))
- Iterate through the priority queue:
  - Get min: O(n)
  - Remove: log(n)
  - Re-add: O(1)?

Space complexity: O(n)

```java
class Solution {
    public String reorganizeString(String s) {
        var a = new int[26];
        var pq = new PriorityQueue<Integer>((l, r) -> Integer.compare(a[r], a[l]));

        for (var c : s.toCharArray()) {
            var i = (int) c - 'a';
            a[i] += 1;
        }

        for (int i = 0; i < 26; i++) {
            if (a[i] > 0) {
                pq.add(i);
            }
        }

        int prev = -1;
        var sb = new StringBuilder();
        while (pq.size() > 0) {
            var curr = pq.poll();
            a[curr] -= 1;
            sb.append((char) ((int) 'a' + curr));
            if (prev != -1 && a[prev] > 0) {
                pq.add(prev);
            }
            prev = curr;
        }

        if (a[prev] > 0) {
            return "";
        }

        return sb.toString();
    }
}
```

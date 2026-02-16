---
title: "Count and Say"
date: 2024-07-26Z-0700
leetcode: true
---

## Problem

The count-and-say sequence is a sequence of digit strings defined by the recursive formula:

- countAndSay(1) = "1"
- countAndSay(n) is the run-length encoding of countAndSay(n - 1).

Run-length encoding (RLE) is a string compression method that works by replacing consecutive identical characters (repeated 2 or more times) with the concatenation of the character and the number marking the count of the characters (length of the run). For example, to compress the string "3322251" we replace "33" with "23", replace "222" with "32", replace "5" with "15" and replace "1" with "11". Thus the compressed string becomes "23321511".

Given a positive integer n, return the nth element of the count-and-say sequence.

Example 1:

```text
Input: n = 4

Output: "1211"

Explanation:

countAndSay(1) = "1"
countAndSay(2) = RLE of "1" = "11"
countAndSay(3) = RLE of "11" = "21"
countAndSay(4) = RLE of "21" = "1211"
```

Example 2:

```text
Input: n = 1

Output: "1"

Explanation:

This is the base case.
```

Constraints:

- 1 <= n <= 30

Follow up: Could you solve it iteratively?

## Solution

```java
class Solution {
    public String countAndSay(int n) {
        if (n == 1) {
            return "1";
        }

        var result = countAndSay(n - 1).toCharArray();
        var sb = new StringBuilder();
        var curr = 'a';
        var quan = 0;

        for (var c : result) {
            if (curr == c) {
                quan += 1;
            } else {
                if (curr != 'a') {
                    sb.append(String.valueOf(quan));
                    sb.append(curr);
                }
                curr = c;
                quan = 1;
            }
        }
        sb.append(String.valueOf(quan));
        sb.append(curr);
        return sb.toString();
    }
}
```

### Another Approach

```java
public String countAndSay(int n) {
    var str = "1";
    for (var i = 2; i <= n; i++) {
        var newStr = "";
        // we want to overwrite the string
        // iterate over the current string
        var count = 1;
        for (var x = 0; x < str.length(); x++) {
            // there are two cases: the this char is the same as the next, or it isn't. if it isn't, it might be because we're out of bounds
            // bounds check always first
            if (x + 1 < str.length() && str.charAt(x + 1) == str.charAt(x)) {
                // match!
                count += 1;
            } else {
                // no match
                newStr = newStr + count + str.charAt(x);
                count = 1;
            }
        }
        str = newStr;
    }
    return str;
}
```

### Extension

Reverse count and say

```java
public void reverse(String s, int index, String prev, String curr, List<String> ans) {
    if (index == s.length()) {
        if (curr.isEmpty()) {
            ans.add(prev);
        }
        return;
    }

    // keep building the chain
    reverse(s, index + 1, prev, curr + s.charAt(index), ans);

    if (!curr.isEmpty()) {
        var quantity = Integer.valueOf(curr);
        var character = s.charAt(index);
        for (int i = 0; i < quantity; i++) {
            prev = prev + character;
        }
        // we can consume this
        reverse(s, index + 1, prev, "", ans);
    }
}
```

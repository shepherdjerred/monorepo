---
title: "Fizz Buzz"
date: 2024-07-24Z-0700
leetcode: true
---

## Problem

Given an integer n, return a string array answer (1-indexed) where:

- answer[i] == "FizzBuzz" if i is divisible by 3 and 5.
- answer[i] == "Fizz" if i is divisible by 3.
- answer[i] == "Buzz" if i is divisible by 5.
- answer[i] == i (as a string) if none of the above conditions are true.

Example 1:

```text
Input: n = 3
Output: ["1","2","Fizz"]
```

Example 2:

```text
Input: n = 5
Output: ["1","2","Fizz","4","Buzz"]
```

Example 3:

```text
Input: n = 15
Output: ["1","2","Fizz","4","Buzz","Fizz","7","8","Fizz","Buzz","11","Fizz","13","14","FizzBuzz"]
```

Constraints:

- 1 <= n <= 104

## Solution

A classic.

```java
class Solution {
    public List<String> fizzBuzz(int n) {
        var l = new ArrayList<String>();
        for (int i = 1; i <= n; i++) {
            if (i % 3 == 0 && i % 5 == 0) {
                l.add("FizzBuzz");
            } else if (i % 3 == 0) {
                l.add("Fizz");
            } else if (i % 5 == 0) {
                l.add("Buzz");
            } else {
                l.add(String.valueOf(i));
            }
        }
        return l;
    }
}
```

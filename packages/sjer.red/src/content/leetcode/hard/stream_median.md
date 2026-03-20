---
title: "Stream Median"
date: 2024-07-26Z-0700
leetcode: true
---

## Problem

The median is the middle value in an ordered integer list. If the size of the list is even, there is no middle value, and the median is the mean of the two middle values.

- For example, for arr = [2,3,4], the median is 3.
- For example, for arr = [2,3], the median is (2 + 3) / 2 = 2.5.

Implement the MedianFinder class:

- MedianFinder() initializes the MedianFinder object.
- void addNum(int num) adds the integer num from the data stream to the data structure.
- double findMedian() returns the median of all elements so far. Answers within 10-5 of the actual answer will be accepted.

Example 1:

```text
Input
["MedianFinder", "addNum", "addNum", "findMedian", "addNum", "findMedian"]
[[], [1], [2], [], [3], []]
Output
[null, null, null, 1.5, null, 2.0]

Explanation
MedianFinder medianFinder = new MedianFinder();
medianFinder.addNum(1);    // arr = [1]
medianFinder.addNum(2);    // arr = [1, 2]
medianFinder.findMedian(); // return 1.5 (i.e., (1 + 2) / 2)
medianFinder.addNum(3);    // arr[1, 2, 3]
medianFinder.findMedian(); // return 2.0
```

Constraints:

- -105 <= num <= 105
- There will be at least one element in the data structure before calling findMedian.
- At most 5 \* 104 calls will be made to addNum and findMedian.

Follow up:

- If all integer numbers from the stream are in the range [0, 100], how would you optimize your solution?
- If 99% of all integer numbers from the stream are in the range [0, 100], how would you optimize your solution?

## Solution

Two heaps!

- One min heap (named top)
- One max heap (named bottom)
- When finding the median, look at the size of the two heaps
  - If the sizes are equal, take the top element from each heap, sum, and divide by two
  - If the sizes are not equal, take the top element from the largest heap
- When inserting:
  - If the value is > the median, add to the heap storing the top half, else add to the bottom half
  - If the difference between the size of the heaps is > 1, move the top element from the larger heap to the smaller heap until the difference < 1

```java
class MedianFinder {
    PriorityQueue<Integer> top;
    PriorityQueue<Integer> btm;

    public MedianFinder() {
        // min heap
        top = new PriorityQueue<>();
        // max heap
        btm = new PriorityQueue<>(Collections.reverseOrder());
    }

    public void addNum(int num) {
        if ((top.size() == 0 && btm.size() == 0) || num <= findMedian()) {
            btm.add(num);
        } else {
            top.add(num);
        }

        if (top.size() - btm.size() > 1) {
            // top is too big
            btm.add(top.poll());
        } else if (btm.size() - top.size() > 1) {
            // btm is too big
            top.add(btm.poll());
        }
    }

    public double findMedian() {
        if (top.size() == btm.size()) {
            return (top.peek() + btm.peek()) / 2.0;
        } else if (top.size() > btm.size()) {
            return top.peek();
        } else {
            return btm.peek();
        }
    }
}

/**
 * Your MedianFinder object will be instantiated and called as such:
 * MedianFinder obj = new MedianFinder();
 * obj.addNum(num);
 * double param_2 = obj.findMedian();
 */
```

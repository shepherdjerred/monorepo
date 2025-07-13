# Functors

### 1. Can we turn the Maybe type constructor into a functor by defining:
```haskell
    fmap _ _ = Nothing
```
    which ignores both of its arguments? (Hint: Check the functor laws.)

### 2. Prove functor laws for the reader functor. Hint: it’s really simple.
### 3. Implement the reader functor in your second favorite language (the first being Haskell, of course).
### 4. Prove the functor laws for the list functor. Assume that the laws are true for the tail part of the list you’re applying it to (in other words, use induction).

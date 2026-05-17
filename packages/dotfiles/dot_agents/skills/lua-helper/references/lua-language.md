# Lua Language Reference

## Language Versions

- **Lua 5.5** (Dec 2025): Global variable declarations, named vararg tables, compact arrays (60% less memory), incremental major GC, read-only for-loop variables
- **Lua 5.4** (2020): Integers, to-be-closed variables, generational GC -- used by WezTerm
- **LuaJIT** (Lua 5.1 compatible): JIT compiler, FFI, ~2-10x faster -- used by Neovim permanently

LuaJIT does not support: integers (5.3+), to-be-closed variables (5.4+), bitwise operators as syntax (5.3+), goto labels selectively. Use `bit` library for bitwise ops in LuaJIT.

## Types

Lua has 8 types: `nil`, `boolean`, `number`, `string`, `function`, `table`, `userdata`, `thread` (coroutine).

```lua
type(nil)           -- "nil"
type(true)          -- "boolean"
type(42)            -- "number"
type('hello')       -- "string"
type(print)         -- "function"
type({})            -- "table"
type(coroutine.create(function() end))  -- "thread"

-- Lua 5.4 distinguishes integer and float subtypes
math.type(42)       -- "integer"  (5.4 only)
math.type(42.0)     -- "float"    (5.4 only)

-- Truthiness: only nil and false are falsy
-- 0, "", and empty tables are truthy
if 0 then print('0 is truthy') end         -- prints
if '' then print('empty string truthy') end -- prints
```

## Variables and Scope

```lua
-- Global (avoid in modules)
my_global = 'visible everywhere'

-- Local (block-scoped)
local x = 10
do
  local y = 20  -- only visible in this block
  x = x + y     -- x from outer scope
end
-- y is nil here

-- Multiple assignment
local a, b, c = 1, 2, 3
local first, rest = 'a', 'b', 'c'  -- rest = 'b', 'c' is discarded

-- Swap
a, b = b, a

-- Lua 5.4: const and close
local x <const> = 42    -- cannot reassign
local f <close> = io.open('file')  -- __close called on scope exit
```

## Numbers

```lua
-- LuaJIT / 5.1: all numbers are double-precision floats
-- Lua 5.4: integer (64-bit) and float (double) subtypes

local i = 42        -- integer in 5.4, float in 5.1
local f = 42.0      -- float
local h = 0xff      -- hex literal = 255
local e = 1.5e3     -- scientific = 1500.0

-- Integer division
-- 5.3+: // operator
-- 5.1/LuaJIT: math.floor(a / b)

-- Bitwise ops
-- 5.3+: &, |, ~, <<, >>
-- LuaJIT: bit.band, bit.bor, bit.bxor, bit.lshift, bit.rshift
local bit = require('bit')       -- LuaJIT
bit.band(0xff, 0x0f)             -- 0x0f
bit.bor(0x01, 0x10)              -- 0x11
bit.lshift(1, 4)                 -- 16

-- Math library
math.abs(-5)         -- 5
math.ceil(4.2)       -- 5
math.floor(4.8)      -- 4
math.max(1, 2, 3)    -- 3
math.min(1, 2, 3)    -- 1
math.sqrt(16)        -- 4
math.random()        -- [0, 1) float
math.random(1, 6)    -- [1, 6] integer
math.huge            -- infinity
math.pi              -- 3.14159...
```

## Strings

```lua
-- String literals
local s1 = 'single quotes'
local s2 = "double quotes"
local s3 = [[
  long string literal
  preserves newlines
  no escape processing
]]
local s4 = [==[
  long string with ]] inside
]==]

-- Concatenation
local full = 'hello' .. ' ' .. 'world'  -- 'hello world'
local num = 'count: ' .. tostring(42)

-- Length
#'hello'  -- 5 (byte count, not character count for UTF-8)

-- String library
string.byte('A')                    -- 65
string.char(65)                     -- 'A'
string.len(s)                       -- byte length
string.rep('ab', 3)                 -- 'ababab'
string.reverse('hello')             -- 'olleh'
string.sub('hello', 2, 4)          -- 'ell' (1-indexed, inclusive)
string.sub('hello', -3)            -- 'llo' (negative = from end)
string.upper('hello')              -- 'HELLO'
string.lower('HELLO')              -- 'hello'

-- Method syntax
s:upper()
s:lower()
s:sub(1, 3)
s:rep(2)
s:find('pattern')
s:match('pattern')
s:gsub('pattern', 'replacement')
s:format(args)
```

## String Patterns

Lua uses its own pattern system (NOT regex).

```lua
-- Character classes
-- %a  letter         %A  non-letter
-- %d  digit          %D  non-digit
-- %l  lowercase      %L  non-lowercase
-- %u  uppercase      %U  non-uppercase
-- %w  alphanumeric   %W  non-alphanumeric
-- %s  whitespace     %S  non-whitespace
-- %p  punctuation    %P  non-punctuation
-- %c  control char   %C  non-control
-- .   any character

-- Quantifiers
-- *   0 or more (greedy)
-- +   1 or more (greedy)
-- -   0 or more (lazy)
-- ?   0 or 1

-- Anchors
-- ^   start of string
-- $   end of string

-- Captures
-- ()  capture group
-- (%w+)  capture one or more alphanumeric

-- Escaping special chars: ( ) . % + - * ? [ ] ^ $
-- Use % to escape: %( for literal (

-- Examples
string.find('hello world', 'world')             -- 7, 11
string.find('hello world', '%a+', 7)            -- 7, 11 (from position 7)

string.match('2025-01-15', '(%d+)-(%d+)-(%d+)') -- '2025', '01', '15'
string.match('key=value', '(%w+)=(.+)')          -- 'key', 'value'
string.match('  hello  ', '^%s*(.-)%s*$')        -- 'hello' (trim)

-- gmatch: iterate all matches
for word in string.gmatch('one two three', '%S+') do
  print(word)
end

-- gmatch with captures
for k, v in string.gmatch('a=1&b=2&c=3', '(%w+)=(%w+)') do
  print(k, v)  -- a 1, b 2, c 3
end

-- gsub: replace
string.gsub('hello world', 'world', 'lua')       -- 'hello lua', 1
string.gsub('aaa', 'a', 'b', 2)                  -- 'bba', 2 (limit=2)
string.gsub('hello', '(%w+)', function(w)
  return w:upper()
end)                                               -- 'HELLO', 1

-- Format (like printf)
string.format('%d items at $%.2f', 5, 9.99)       -- '5 items at $9.99'
string.format('%q', 'she said "hi"')               -- '"she said \\"hi\\""'
string.format('%02x', 255)                         -- 'ff'
string.format('%-20s|', 'left-aligned')            -- 'left-aligned        |'
```

## Tables

### Array Operations

```lua
local arr = { 10, 20, 30, 40, 50 }

-- Length (only counts consecutive integer keys from 1)
#arr  -- 5

-- Access (1-indexed)
arr[1]   -- 10
arr[#arr] -- 50 (last element)

-- Append
arr[#arr + 1] = 60
table.insert(arr, 70)         -- append
table.insert(arr, 1, 0)       -- prepend (shifts others)

-- Remove
table.remove(arr)              -- remove last
table.remove(arr, 1)           -- remove first (shifts others)

-- Sort
table.sort(arr)                            -- ascending
table.sort(arr, function(a, b) return a > b end)  -- descending

-- Sort complex structures
local items = { { name = 'b', val = 2 }, { name = 'a', val = 1 } }
table.sort(items, function(a, b) return a.name < b.name end)

-- Concatenate to string
table.concat({ 'a', 'b', 'c' }, ', ')  -- 'a, b, c'
table.concat({ 'a', 'b', 'c' })        -- 'abc'

-- Move (5.3+)
table.move(arr, 1, 3, 5)      -- copy elements 1-3 to positions 5-7
table.move(src, 1, #src, #dst + 1, dst)  -- append src to dst

-- Unpack (convert array to multiple returns)
local a, b, c = table.unpack({ 10, 20, 30 })
-- LuaJIT: unpack() (global, not table.unpack)
```

### Dictionary Operations

```lua
local dict = {
  name = 'example',
  count = 42,
  ['special-key'] = true,
}

-- Access
dict.name               -- 'example'
dict['special-key']     -- true

-- Set / update
dict.new_key = 'value'
dict['another'] = 123

-- Delete
dict.name = nil

-- Check existence
if dict.count then ... end
if dict.count ~= nil then ... end  -- more explicit

-- Iterate (order not guaranteed)
for key, value in pairs(dict) do
  print(key, value)
end

-- Get keys
local keys = {}
for k in pairs(dict) do
  keys[#keys + 1] = k
end

-- Merge (shallow)
local function merge(a, b)
  local result = {}
  for k, v in pairs(a) do result[k] = v end
  for k, v in pairs(b) do result[k] = v end
  return result
end
-- In Neovim: vim.tbl_extend('force', a, b)
```

### Iteration Patterns

```lua
-- ipairs: array part (1, 2, 3...), stops at first nil
for i, v in ipairs(arr) do
  print(i, v)
end

-- pairs: all keys (unordered)
for k, v in pairs(tbl) do
  print(k, v)
end

-- Numeric for
for i = 1, #arr do
  print(arr[i])
end

-- Reverse iteration
for i = #arr, 1, -1 do
  print(arr[i])
end

-- Safe removal during iteration (reverse)
for i = #arr, 1, -1 do
  if should_remove(arr[i]) then
    table.remove(arr, i)
  end
end

-- next() for checking if table is empty
if next(tbl) == nil then
  print('table is empty')
end
```

## Metatables

### Core Metamethods

```lua
-- __index: called when key not found in table
-- Can be a table (prototype lookup) or function (computed access)
local defaults = { color = 'blue', size = 10 }
local obj = setmetatable({}, { __index = defaults })
print(obj.color)  -- 'blue' (from defaults)
obj.color = 'red'
print(obj.color)  -- 'red' (own property now)

-- __index as function
setmetatable(obj, {
  __index = function(self, key)
    return 'default_' .. key
  end,
})

-- __newindex: called when setting key that doesn't exist
setmetatable(obj, {
  __newindex = function(self, key, value)
    if type(value) ~= 'number' then
      error('only numbers allowed')
    end
    rawset(self, key, value)  -- bypass __newindex
  end,
})

-- Arithmetic metamethods
-- __add (+), __sub (-), __mul (*), __div (/), __mod (%), __pow (^)
-- __unm (unary -), __idiv (//, 5.3+)

-- Comparison metamethods
-- __eq (==), __lt (<), __le (<=)

-- Other metamethods
-- __concat (..), __len (#), __call (function call syntax)
-- __tostring (tostring()), __pairs (pairs()), __ipairs (ipairs())
-- __gc (garbage collection finalizer)
-- __close (to-be-closed, 5.4+)

-- __call: make table callable
local callable = setmetatable({}, {
  __call = function(self, ...)
    return 'called with: ' .. table.concat({...}, ', ')
  end,
})
callable('a', 'b')  -- 'called with: a, b'

-- __tostring: custom string representation
setmetatable(obj, {
  __tostring = function(self)
    return string.format('Obj(%s)', self.name)
  end,
})
print(obj)  -- 'Obj(example)'

-- __len: custom length
setmetatable(obj, {
  __len = function(self)
    local count = 0
    for _ in pairs(self) do count = count + 1 end
    return count
  end,
})
print(#obj)  -- number of all keys
```

### Raw Access (Bypass Metamethods)

```lua
rawget(tbl, key)          -- get without __index
rawset(tbl, key, value)   -- set without __newindex
rawlen(tbl)               -- length without __len
rawequal(a, b)            -- compare without __eq
```

## Object-Oriented Patterns

### Class with Inheritance

```lua
-- Base class
local Animal = {}
Animal.__index = Animal

function Animal.new(name, sound)
  return setmetatable({
    name = name,
    sound = sound,
  }, Animal)
end

function Animal:speak()
  return self.name .. ' says ' .. self.sound
end

function Animal:get_name()
  return self.name
end

-- Subclass
local Dog = setmetatable({}, { __index = Animal })
Dog.__index = Dog

function Dog.new(name)
  local self = Animal.new(name, 'woof')
  return setmetatable(self, Dog)
end

function Dog:fetch(item)
  return self.name .. ' fetches ' .. item
end

-- Usage
local rex = Dog.new('Rex')
rex:speak()          -- 'Rex says woof' (inherited)
rex:fetch('ball')    -- 'Rex fetches ball' (own method)
```

### Mixin Pattern

```lua
local Serializable = {}
function Serializable:serialize()
  local parts = {}
  for k, v in pairs(self) do
    parts[#parts + 1] = k .. '=' .. tostring(v)
  end
  return '{' .. table.concat(parts, ', ') .. '}'
end

local Loggable = {}
function Loggable:log(msg)
  print('[' .. (self.name or '?') .. '] ' .. msg)
end

-- Apply mixins
local function mixin(class, ...)
  for _, m in ipairs({...}) do
    for k, v in pairs(m) do
      if class[k] == nil then
        class[k] = v
      end
    end
  end
end

local MyClass = {}
MyClass.__index = MyClass
mixin(MyClass, Serializable, Loggable)
```

### Encapsulation with Closures

```lua
local function create_counter(initial)
  local count = initial or 0  -- private state

  return {
    increment = function() count = count + 1 end,
    decrement = function() count = count - 1 end,
    get = function() return count end,
  }
end

local c = create_counter(10)
c.increment()
c.increment()
print(c.get())  -- 12
-- count is not accessible directly
```

## Closures and Upvalues

```lua
-- A closure captures variables from its enclosing scope
function make_adder(n)
  return function(x)
    return x + n  -- n is an upvalue
  end
end

local add5 = make_adder(5)
add5(10)  -- 15

-- Iterator factory using closure
function range(start, stop, step)
  step = step or 1
  local current = start - step
  return function()
    current = current + step
    if current <= stop then
      return current
    end
  end
end

for i in range(1, 5) do print(i) end

-- Memoization
function memoize(fn)
  local cache = {}
  return function(...)
    local key = table.concat({...}, ',')
    if cache[key] == nil then
      cache[key] = fn(...)
    end
    return cache[key]
  end
end

local fib = memoize(function(n)
  if n < 2 then return n end
  return fib(n - 1) + fib(n - 2)
end)
```

## Coroutines

```lua
-- Create coroutine
local co = coroutine.create(function(x)
  print('start:', x)
  local y = coroutine.yield(x * 2)
  print('resumed:', y)
  return x + y
end)

-- Resume (first call passes args to function, subsequent calls pass args to yield)
local ok, val = coroutine.resume(co, 10)   -- start: 10,  ok=true val=20
local ok, val = coroutine.resume(co, 5)    -- resumed: 5, ok=true val=15
local ok, val = coroutine.resume(co)       -- ok=false (dead)

-- Status
coroutine.status(co)  -- 'dead', 'suspended', 'running', 'normal'

-- Wrap (returns function that auto-resumes)
local gen = coroutine.wrap(function()
  for i = 1, 3 do
    coroutine.yield(i)
  end
end)

gen()  -- 1
gen()  -- 2
gen()  -- 3
gen()  -- error: cannot resume dead coroutine

-- Producer-consumer pattern
local function producer()
  return coroutine.wrap(function()
    for i = 1, 10 do
      coroutine.yield(i)
    end
  end)
end

local function consumer(gen)
  for value in gen do
    print('consumed:', value)
  end
end

consumer(producer())

-- Pipeline
local function map(gen, fn)
  return coroutine.wrap(function()
    for v in gen do
      coroutine.yield(fn(v))
    end
  end)
end

local function filter(gen, predicate)
  return coroutine.wrap(function()
    for v in gen do
      if predicate(v) then
        coroutine.yield(v)
      end
    end
  end)
end

-- Usage: filter(map(producer(), double), is_even)
```

## Modules

### Module Definition

```lua
-- mymodule.lua
local M = {}

-- Private (not in M table)
local cache = {}

local function helper()
  return 'internal'
end

-- Public
function M.setup(opts)
  M.config = opts or {}
end

function M.process(input)
  if cache[input] then return cache[input] end
  local result = helper() .. ':' .. input
  cache[input] = result
  return result
end

return M
```

### Module Loading

```lua
-- require caches by module name
local mod = require('mymodule')
local sub = require('mymodule.submodule')  -- searches mymodule/submodule.lua

-- Force reload
package.loaded['mymodule'] = nil
local mod = require('mymodule')

-- Search paths
package.path    -- Lua module search path (semicolon separated)
-- Example: ./?.lua;./?/init.lua;/usr/share/lua/5.1/?.lua

package.cpath   -- C module search path
-- Example: ./?.so;/usr/lib/lua/5.1/?.so

-- Custom searcher
table.insert(package.searchers, function(name)
  -- custom module resolution
end)
```

## Error Handling

```lua
-- Raise error
error('something went wrong')
error('bad argument', 2)  -- level 2 = caller's location
error({ code = 404, msg = 'not found' })  -- error object

-- Assert (raises error if condition is falsy)
assert(x > 0, 'x must be positive')
local f = assert(io.open('file'), 'cannot open file')

-- Protected call
local ok, result = pcall(function()
  return dangerous_operation()
end)
if ok then
  use(result)
else
  handle_error(result)
end

-- Protected call with error handler
local ok, result = xpcall(function()
  return dangerous_operation()
end, function(err)
  return debug.traceback(err, 2)  -- add stack trace
end)

-- Common patterns
-- 1. Result-or-error
local function divide(a, b)
  if b == 0 then return nil, 'division by zero' end
  return a / b
end
local result, err = divide(10, 0)
if err then print(err) end

-- 2. Assert result-or-error
local result = assert(divide(10, 2))  -- raises on error

-- 3. Finally pattern (cleanup)
local function with_file(path, fn)
  local f, err = io.open(path, 'r')
  if not f then return nil, err end
  local ok, result = pcall(fn, f)
  f:close()
  if not ok then error(result) end
  return result
end
```

## I/O

```lua
-- Read file
local f = io.open('file.txt', 'r')
local content = f:read('*a')   -- read all
f:close()

-- Read lines
for line in io.lines('file.txt') do
  print(line)
end

-- Write file
local f = io.open('file.txt', 'w')  -- 'w' = write, 'a' = append
f:write('hello\n')
f:write(string.format('count: %d\n', 42))
f:close()

-- Read modes
f:read('*a')   -- all content
f:read('*l')   -- line (no newline) -- default
f:read('*L')   -- line (with newline, 5.2+)
f:read('*n')   -- number
f:read(10)     -- 10 bytes

-- Standard I/O
io.read()       -- read line from stdin
io.write('out') -- write to stdout
io.stderr:write('err')

-- OS operations
os.clock()      -- CPU time
os.time()       -- current time (seconds since epoch)
os.date('%Y-%m-%d')  -- formatted date
os.getenv('HOME')    -- environment variable
os.execute('ls')     -- run shell command
os.tmpname()         -- temporary file name
os.rename(old, new)
os.remove(path)
```

## LuaRocks Package Manager

```bash
# Install LuaRocks
brew install luarocks        # macOS
apt install luarocks         # Debian/Ubuntu

# Install a package
luarocks install luasocket
luarocks install --local penlight   # user-local install

# List installed
luarocks list

# Search
luarocks search json

# Show info
luarocks show luasocket

# Remove
luarocks remove luasocket

# Install for specific Lua version
luarocks --lua-version=5.1 install lpeg

# Use with Neovim (rocks.nvim plugin manager)
# rocks.nvim integrates LuaRocks directly into Neovim plugin management
```

## Performance Tips

```lua
-- Local access is faster than global
local pairs = pairs
local ipairs = ipairs
local type = type
local insert = table.insert

-- Pre-allocate tables when size is known
local t = {}
for i = 1, 1000 do t[i] = 0 end  -- better than repeated insert

-- String concatenation: use table.concat for many strings
local parts = {}
for i = 1, 1000 do
  parts[i] = 'item' .. i
end
local result = table.concat(parts, '\n')  -- much faster than .. in loop

-- Avoid creating tables in hot loops
local reuse = {}
for i = 1, 1000000 do
  reuse[1] = i          -- reuse table
  process(reuse)
end

-- Use # operator carefully: undefined for tables with holes
-- { 1, nil, 3 } -- #t could be 1 or 3
```

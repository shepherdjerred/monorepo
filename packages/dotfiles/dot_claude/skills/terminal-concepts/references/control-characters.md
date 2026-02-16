# ASCII Control Characters

## The 33 Control Characters

Control characters are created by holding Ctrl and pressing a key. There are 33 total:
- Ctrl-A through Ctrl-Z (26 characters)
- Plus 7 more: Ctrl-@, Ctrl-[, Ctrl-\, Ctrl-], Ctrl-^, Ctrl-_, Ctrl-?

## Three Categories

**1. OS-Handled (Terminal Driver Intercepts)**:

| Key | ASCII | Name | Function |
|-----|-------|------|----------|
| Ctrl-C | 3 | ETX | Sends SIGINT (interrupt) |
| Ctrl-D | 4 | EOT | EOF when line is empty |
| Ctrl-Z | 26 | SUB | Sends SIGTSTP (suspend) |
| Ctrl-S | 19 | XOFF | Freezes output (flow control) |
| Ctrl-Q | 17 | XON | Resumes output |
| Ctrl-\ | 28 | FS | Sends SIGQUIT |

**2. Keyboard Literals**:

| Key | ASCII | Name | Usage |
|-----|-------|------|-------|
| Enter | 13 | CR | Line terminator |
| Tab | 9 | HT | Tab character |
| Backspace | 127 | DEL | Delete previous character |
| Ctrl-H | 8 | BS | Often same as backspace |

**3. Application-Specific** (Your Program Can Define):

| Key | Common Usage |
|-----|--------------|
| Ctrl-A | Move to line start (readline, emacs) |
| Ctrl-E | Move to line end |
| Ctrl-W | Delete word backwards |
| Ctrl-U | Delete line |
| Ctrl-K | Kill to end of line |
| Ctrl-R | Reverse search (shells) |
| Ctrl-L | Clear screen |
| Ctrl-P/N | Previous/Next (history navigation) |

## What Developers Can and Cannot Intercept

**In Cooked Mode**:
- OS handles: Ctrl-C, Ctrl-D, Ctrl-Z, Ctrl-S, Ctrl-Q
- You see: Ctrl-A, Ctrl-E, Ctrl-W (already processed by line editing)

**In Raw Mode** (TUIs):
- You can intercept almost everything including Ctrl-C
- **Exception**: Ctrl-Z often still suspends (OS-level)
- You must handle all line editing yourself

**Best Practice**: Respect user expectations. Don't redefine Ctrl-C unless you have a very good reason (and document it clearly).

## Limited Modifier Combinations

Unlike GUI applications, terminals have severe limitations:
- **Only 33 Ctrl combinations** total
- Ctrl-Shift-X **doesn't exist** as a distinct character
- Ctrl-[number] combinations limited
- Alt/Meta combinations inconsistent across terminals

**Implication**: Design keyboard shortcuts carefully. You have far fewer options than GUI apps.

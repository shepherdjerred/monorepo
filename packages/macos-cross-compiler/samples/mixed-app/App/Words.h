#ifndef WORDS_H
#define WORDS_H

#ifdef __cplusplus
extern "C" {
#endif

/// Implemented in C++ (std::string), callable from C, Objective-C, and Swift.
unsigned long mixed_word_count(const char *text);

#ifdef __cplusplus
}
#endif

#endif

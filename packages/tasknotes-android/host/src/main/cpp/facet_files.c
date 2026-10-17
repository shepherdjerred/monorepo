#include <jni.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/stat.h>
#include <unistd.h>

// These primitives retain one descriptor while inspecting/copying a regular
// file. They return only bounded metadata; Kotlin never receives a file array.
static char *facet_path(JNIEnv *env, jbyteArray value) {
    if (value == NULL) return NULL;
    jsize size = (*env)->GetArrayLength(env, value);
    if (size <= 0 || size > 65536) return NULL;
    char *path = calloc((size_t)size + 1, 1);
    if (path == NULL) return NULL;
    (*env)->GetByteArrayRegion(env, value, 0, size, (jbyte *)path);
    if ((*env)->ExceptionCheck(env) || memchr(path, 0, (size_t)size) != NULL) {
        free(path); return NULL;
    }
    return path;
}

static jlongArray facet_stamp(JNIEnv *env, int failure, const struct stat *stamp) {
    jlong values[7] = {failure, 0, 0, 0, 0, 0, 0};
    if (failure == 0) {
        values[1] = (jlong)stamp->st_dev;
        values[2] = (jlong)stamp->st_ino;
        values[3] = (jlong)stamp->st_size;
        values[4] = (jlong)stamp->st_mtim.tv_sec;
        values[5] = (jlong)stamp->st_mtim.tv_nsec;
        values[6] = (jlong)stamp->st_mode;
    }
    jlongArray result = (*env)->NewLongArray(env, 7);
    if (result != NULL) (*env)->SetLongArrayRegion(env, result, 0, 7, values);
    return result;
}

JNIEXPORT jlongArray JNICALL
Java_red_sjer_facet_host_AtomicFiles_identityNative(JNIEnv *env, jclass clazz, jbyteArray value) {
    (void)clazz;
    char *path = facet_path(env, value);
    if (path == NULL) return facet_stamp(env, EINVAL, NULL);
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    int failure = fd < 0 ? errno : 0;
    free(path);
    struct stat stamp = {0};
    if (failure == 0 && fstat(fd, &stamp) != 0) failure = errno;
    if (failure == 0 && (!S_ISREG(stamp.st_mode) || stamp.st_size < 0)) failure = EINVAL;
    if (fd >= 0 && close(fd) != 0 && failure == 0) failure = errno;
    return facet_stamp(env, failure, &stamp);
}

JNIEXPORT jlongArray JNICALL
Java_red_sjer_facet_host_AtomicFiles_captureNative(
    JNIEnv *env, jclass clazz, jbyteArray source, jbyteArray destination) {
    (void)clazz;
    char *source_path = facet_path(env, source);
    char *destination_path = facet_path(env, destination);
    if (source_path == NULL || destination_path == NULL) {
        free(source_path); free(destination_path); return facet_stamp(env, EINVAL, NULL);
    }
    int input = open(source_path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    int failure = input < 0 ? errno : 0;
    int output = -1;
    struct stat before = {0}, after = {0};
    if (failure == 0 && fstat(input, &before) != 0) failure = errno;
    if (failure == 0 && (!S_ISREG(before.st_mode) || before.st_size < 0)) failure = EINVAL;
    if (failure == 0) {
        output = open(destination_path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (output < 0) failure = errno;
    }
    unsigned char buffer[65536];
    off_t copied = 0;
    while (failure == 0) {
        ssize_t count = read(input, buffer, sizeof(buffer));
        if (count < 0) { if (errno == EINTR) continue; failure = errno; break; }
        if (count == 0) break;
        if (count > before.st_size - copied) { failure = EAGAIN; break; }
        size_t written = 0;
        while (written < (size_t)count) {
            ssize_t part = write(output, buffer + written, (size_t)count - written);
            if (part < 0 && errno == EINTR) continue;
            if (part <= 0) { failure = part < 0 ? errno : EIO; break; }
            written += (size_t)part;
        }
        copied += count;
    }
    memset(buffer, 0, sizeof(buffer));
    if (failure == 0 && fstat(input, &after) != 0) failure = errno;
    if (failure == 0 && (copied != before.st_size || before.st_dev != after.st_dev || before.st_ino != after.st_ino ||
        before.st_size != after.st_size || before.st_mtim.tv_sec != after.st_mtim.tv_sec || before.st_mtim.tv_nsec != after.st_mtim.tv_nsec))
        failure = EAGAIN;
    if (output >= 0 && close(output) != 0 && failure == 0) failure = errno;
    if (input >= 0 && close(input) != 0 && failure == 0) failure = errno;
    // The caller owns this exclusively created private image, including cleanup
    // on EAGAIN. Neither path is unlinked here on ambiguous provider failure.
    free(source_path); free(destination_path);
    return facet_stamp(env, failure, &before);
}

// Host I/O only: Linux atomically swaps file names or creates only if absent.
// NDK headers supply architecture-specific syscall numbers. Java supplies UTF-8
// byte arrays so supplementary Unicode characters never become modified UTF-8.
JNIEXPORT jint JNICALL
Java_red_sjer_facet_host_AtomicFiles_renameNative(
    JNIEnv *env, jclass clazz, jbyteArray source, jbyteArray destination, jint flags) {
    (void)clazz;
    jsize source_size = (*env)->GetArrayLength(env, source);
    jsize destination_size = (*env)->GetArrayLength(env, destination);
    if (source_size == 0 || destination_size == 0) return EINVAL;
    char *source_path = calloc((size_t)source_size + 1, 1);
    char *destination_path = calloc((size_t)destination_size + 1, 1);
    if (source_path == NULL || destination_path == NULL) {
        free(source_path); free(destination_path); return ENOMEM;
    }
    (*env)->GetByteArrayRegion(env, source, 0, source_size, (jbyte *)source_path);
    (*env)->GetByteArrayRegion(env, destination, 0, destination_size, (jbyte *)destination_path);
    if ((*env)->ExceptionCheck(env)) { free(source_path); free(destination_path); return EINVAL; }
    if (memchr(source_path, 0, (size_t)source_size) != NULL || memchr(destination_path, 0, (size_t)destination_size) != NULL) {
        free(source_path); free(destination_path); return EINVAL;
    }
    long result = syscall(SYS_renameat2, AT_FDCWD, source_path, AT_FDCWD, destination_path, (unsigned int)flags);
    int failure = result == 0 ? 0 : errno;
    free(source_path); free(destination_path);
    return failure;
}

JNIEXPORT jint JNICALL
Java_red_sjer_facet_host_AtomicFiles_synchronizeNative(JNIEnv *env, jclass clazz, jbyteArray directory) {
    (void)clazz;
    jsize size = (*env)->GetArrayLength(env, directory);
    if (size == 0) return EINVAL;
    char *path = calloc((size_t)size + 1, 1);
    if (path == NULL) return ENOMEM;
    (*env)->GetByteArrayRegion(env, directory, 0, size, (jbyte *)path);
    if ((*env)->ExceptionCheck(env) || memchr(path, 0, (size_t)size) != NULL) { free(path); return EINVAL; }
    int directory_fd = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    int failure = directory_fd < 0 ? errno : 0;
    free(path);
    if (directory_fd >= 0) {
        if (fsync(directory_fd) != 0) failure = errno;
        close(directory_fd);
    }
    return failure;
}

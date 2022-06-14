from matcher import execute
import sys


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(f'Arguments missing. Expected 2 but got {len(sys.argv) - 1}')
        exit(1)

    file_list_path = sys.argv[1]
    string_list_path = sys.argv[2]

    print(f'File list path: {file_list_path}')
    print(f'String list path: {string_list_path}')

    execute(file_list_path, string_list_path)

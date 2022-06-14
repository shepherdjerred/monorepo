from os import listdir
from os.path import isfile, join


def get_file_list_from_directory(path):
    return [f for f in listdir(path) if isfile(join(path, f))]


def get_string_list_from_file(file_path):
    with open(file_path) as file:
        content = file.readlines()
        content = [x.strip() for x in content]
        return content


def get_file_list():
    return ['File1String1', 'File2String2', 'File3']


def get_string_list():
    return ['String1', 'String2', 'String2', 'String4']


def get_string_counts(strings):
    string_counts = {}
    for string in strings:
        if string_counts.get(string):
            string_counts[string] += 1
        else:
            string_counts[string] = 1
    return string_counts


def match(files, strings):
    matches = {}
    for file in files:
        for string in strings:
            if string not in matches:
                matches[string] = []
            if string in file:
                matches[string].append(file)
    return matches


def get_files_match_counts(files, matches):
    file_match_counts = {}

    for file in files:
        file_match_counts[file] = 0

    for string, files in matches.items():
        for file in files:
            file_match_counts[file] += 1
    return file_match_counts


def get_files_without_matches(file_match_counts):
    files_without_matches = []

    for file, count in file_match_counts.items():
        if count == 0:
            files_without_matches.append(file)
    return files_without_matches


def print_results(files, strings, matches):
    for string, file_matches in matches.items():
        print(f'{string} is in {file_matches}')

    strings_without_result = get_strings_without_result(matches)
    for string in strings_without_result:
        print(f'{string} does not have a file')

    duplicated_strings = get_duplicated_strings(strings)
    for (string, count) in duplicated_strings:
        print(f'{string} occurs {count} times')

    file_match_counts = get_files_match_counts(files, matches)
    files_without_matches = get_files_without_matches(file_match_counts)

    for file in files_without_matches:
        print(f'{file} does not match any string')

    print(f'Number of strings: {len(strings)}')
    print(f'Number of files: {len(files)}')
    print(f'A total of {len(strings_without_result)} strings do not have a file')
    print(f'A total of {len(duplicated_strings)} strings occur more than once')
    print(f'A total of {len(files_without_matches)} files have no matches')


def get_duplicated_strings(strings):
    duplicated_strings = []
    string_counts = get_string_counts(strings)
    for string, count in string_counts.items():
        if count > 1:
            duplicated_strings.append((string, count))
    return duplicated_strings


def get_strings_without_result(matches):
    strings_without_match = []
    for string, files in matches.items():
        if len(files) == 0:
            strings_without_match.append(string)
    return strings_without_match


def execute(file_path, string_list_path):
    files = get_file_list_from_directory(file_path)
    strings = get_string_list_from_file(string_list_path)
    matches = match(files, strings)
    print_results(files, strings, matches)

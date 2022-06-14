import pandas as pd


def load_entries_from_file():
    return pd.read_csv("../resources/income.csv", skipinitialspace=True)


def calculate_previous_occurrences(delay, period, month):
    month_minus_delay = month - delay - 1
    return month_minus_delay if period == 0 else month_minus_delay / period


def does_income_apply_to_month(delay, period, max_occurrences, month):
    previous_occurrences = calculate_previous_occurrences(delay, period, month)

    if month > delay:
        if period == 0 or (month - delay) % period == 0:
            if max_occurrences == -1 or previous_occurrences < max_occurrences:
                return True
    return False


def calculate_income_for_month(income_entries, month):
    income_for_month = 0

    for index, row in income_entries.iterrows():
        delay = row["delay in months"]
        period = row["period in months"]
        max_occurrences = row["occurrences"]

        if does_income_apply_to_month(delay, period, max_occurrences, month):
            income_for_month += row["amount"]

    return income_for_month

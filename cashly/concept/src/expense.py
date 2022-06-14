import pandas as pd


def load_entries_from_file():
    return pd.read_csv("../resources/expenses.csv", skipinitialspace=True)


def does_expense_apply_to_month():
    return True


def calculate_expenses_for_month(expense_entries):
    expenses = 0

    for index, row in expense_entries.iterrows():
        cost = row["cost"]

        if does_expense_apply_to_month():
            expenses += cost

    return expenses

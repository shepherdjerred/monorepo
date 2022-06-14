import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns


def graph(months):
    ax = sns.lineplot(data=months, dashes=False)
    ax.grid(True)
    plt.title("Monthly Finances")
    plt.show()


def plot_income(months):
    plot = pd.Series(months["income"].values, months["month"].values,
                     name="Monthly Income")
    plot.plot(label="Income")

    plt.legend()
    plt.show()


def plot_expenses(months):
    plot = pd.Series(months["expenses"].values, months["month"].values,
                     name="Monthly Expenses")
    plot.plot(label="Expenses")

    plt.legend()
    plt.show()


def plot_net(months):
    net = months["income"].values - months["expenses"].values

    plot = pd.Series(net, months["month"].values, name="Monthly Net Income")
    plot.plot(label="Net Income")

    plt.legend()
    plt.show()


def plot_savings(months):
    net = months["income"].values - months["expenses"].values

    plot = pd.Series(net.cumsum(), months["month"].values,
                     name="Cumulative Savings")
    plot.plot(label="Cumulative Savings")

    plt.legend()
    plt.show()

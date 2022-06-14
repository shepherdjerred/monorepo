import pandas as pd


def visualize(results):
    pd.set_option('display.max_columns', None)
    pd.set_option('display.max_rows', None)
    pd.options.display.width = 0

    dataframe = pd.DataFrame(result.to_dict() for result in results)
    dataframe = dataframe.sort_values(by=['cost per person', 'total cost'], ascending=True)
    dataframe = dataframe.round(decimals=0)
    print(dataframe)

---
title: Read & Visualize
output: html_document
---

```{r setup, include = FALSE}
knitr::opts_chunk$set(echo = TRUE)

# Load your libraries here
library(tidyverse)
```

## Read & Visualize

In this milestone you'll display the "enjoyability" ratings from the dataset as a bar plot.

Remember that all tidyverse packages have already been installed for you. But you will need to *load* the ones you want to use with `library()`. As a best practice when working within an R Markdown document like this one, you should always load packages in the code chunk labelled `setup`, above.


## Recreate This

You'll visualize results in a plot like the one below.


```{r recreate-this, message = FALSE}
# code to view preview of solution
knitr::include_graphics("images/solution2.png")
```

### Recreation

Use what you learned from this week's tutorials to import the `survey_subset` dataset and recreate the plot above. Read in the data directly from `data/survey_subset.csv`. Complete your work in the code chunk below. You may add more code chunks.

*Note*: It is okay if ggplot creates some warning messages related to missing values -- these are related to missing values in the dataset.)


```{r recreation}
read_csv("data/survey_subset.csv") %>%
  ggplot(data = . , mapping = aes(x = enjoyability)) + geom_bar(aes(fill = use_frequency))
```

## Extension

For your extension consider modifying the plot you made above in some way or making a new visualization entirely. You do not have to limit yourself to the ggplot2 package. It is okay if your extension has more than one part to it, but please choose only one piece to teach the rest of your group so that you can comfortably go through the extension in ~5 minutes or less. 


```{r extension}
read_csv("data/survey_subset.csv") %>%
  ggplot(data = . , mapping = aes(x = enjoyability, y = use_frequency)) + geom_point(aes(size = count()))


#read_csv("data/survey_subset.csv") %>%
#  drop_na() %>% 
#  ggplot(data = . , mapping = aes(x = enjoyability, y = use_frequency)) + geom_bin_2d(bins = 5, drop = TRUE)
```


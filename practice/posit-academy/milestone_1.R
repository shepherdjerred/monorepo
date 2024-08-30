---
title: R Basics
output: html_document
---

```{r setup, include = FALSE}
# The code below loads a table for us to use. 
# You can ignore how we do this until next week.
survey_subset <- readr::read_csv("https://rsacdn.link/milestones/internal/R_community_survey/4wks/data/survey_subset.csv")

# Remember that all tidyverse packages have already been installed for you, 
# but you will need to *load* the ones you want to use.

# Load any packages you need below:
library(dplyr)
library(tidyr)
```

## R Basics

In this milestone, you will use a subset of the 2020 R Community Survey data called `survey_subset`. 

First, run the `setup` chunk above to load the dataset. After running this code, you should have an object named `survey_subset` available in your Environment pane. Then, use the code chunk below to explore it:  


```{r explore}
survey_subset
```

Remember that you can see what each of the variables represent in `survey_subset` by looking them up in the data dictionary linked in the sidebar to your left.


## Recreate This

Run the code chunk below to see a table. Your first goal is to recreate this table in the "Recreation" section below.


```{r recreate-this, message = FALSE}
readr::read_csv("data/solution1.csv")
```

This table tabulates the answers to the following survey question:

> "Please rate how much you enjoy using R on a scale of 1 to 5, where 1 is you don't enjoy it at all, and 5 is that you enjoy it a great deal." 

Remember that you can look up the wording of this question, as well as the other questions from the survey in the data dictionary, accessible in the sidebar to your left.



### Recreation

Use the `survey_subset` dataset and what you learned from this week's tutorials to recreate the table. Complete your work in the code chunk below. You may add additional code chunks.


```{r recreation}
survey_subset %>%
  group_by(enjoyability) %>%
  count
```

## Extension

Extend this milestone by exploring something else about the dataset with a new function. Try to get some practice using help page documentation.

For example, you might be interested in installing and loading the [janitor package](http://sfirke.github.io/janitor/) and exploring one of its functions, Or you might want to check out one of the [`slice()` functions from the dplyr package](https://dplyr.tidyverse.org/reference/slice.html), which lets you quickly sample just a few rows from a big dataset to get a feel for its contents.

You can get a sense for the appropriate scope of a milestone extension with this [video](https://rstudio.wistia.com/medias/19b2a5inym).

Write your extension code in the following chunk, and be ready to share your thought process and screenshare your code at our next group session. (If your extension has many parts, just focus on one to share at the session. You should budget no more than 5-7 minutes for sharing.) 
```{r extension}
responses_per_country <- survey_subset %>%
  drop_na(country) %>%
  drop_na(enjoyability) %>% 
  group_by(country) %>%
  count

enjoyability_by_country <- survey_subset %>%
  drop_na(country) %>%
  drop_na(enjoyability) %>% 
  group_by(country) %>%
  summarise(sum_enjoyability = sum(enjoyability))


both = merge(responses_per_country, enjoyability_by_country)

both$avg_enjoyability <- with(both, sum_enjoyability / n)

both %>% filter(n > 20) %>% arrange(desc(avg_enjoyability))
```

```{r extension}
polarization <- survey_subset %>%
  drop_na(country) %>%
  drop_na(enjoyability) %>% 
  group_by(country) %>%
  summarise(polarization = sd(enjoyability)) %>% 
  drop_na(polarization) %>% 
  filter(polarization != 0) %>% 
  arrange(desc(polarization))
polarization
```


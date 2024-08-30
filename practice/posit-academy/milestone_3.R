---
title: Transform tables
output: html_document
---

## Recreation

In the previous two milestones, you worked with a subset of the data. In this milestone, you can use the full data. Read in the full data from `data/survey_full.csv`. 

Then, transform the data into the following table:


```{r setup, message = FALSE, warning = FALSE}
goal <- readr::read_csv("https://rsacdn.link/milestones/internal/R_community_survey/4wks/data/solution3.csv")

# load any packages below
library(tidyverse)

goal
```

```{r recreation}
readr::read_csv("data/survey_full.csv") %>%
  filter(experience != "None") %>%
  group_by(experience) %>%
  summarise(
    avg_enjoyability = mean(enjoyability, na.rm=TRUE) %>% round,
    avg_recommend = mean(recommend, na.rm=TRUE) %>% round
  )
```

## Extension

For your extension, consider the following options:

* Filter the data
* Summarize the data in other ways
* Apply additional transformations with dplyr
* For an extra challenge, look up up the help page for the [`across()` function from dplyr](https://dplyr.tidyverse.org/reference/across.html) and use it to calculate summary statistics for multiple variables all at once

Write your extension code in the following chunk:


```{r extension}
readr::read_csv("data/survey_full.csv") %>%
  filter(experience != "None") %>%
  group_by(country) %>%
  summarise(
    avg_enjoyability = mean(enjoyability, na.rm=TRUE) %>% round,
    avg_recommend = mean(recommend, na.rm=TRUE) %>% round
  ) %>%
  arrange(avg_enjoyability)
```


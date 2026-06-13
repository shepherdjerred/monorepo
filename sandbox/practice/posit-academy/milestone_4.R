---
title: 2020 RStudio Community Survey
author: Jerred Shepherd
output:
  html_document:
    toc_float: true
    toc: TRUE
    theme: flatly
---

```{r setup, include = FALSE}
knitr::opts_chunk$set(echo = FALSE, message = FALSE, warning = FALSE)

library(tidyverse)
library(rmarkdown)

survey_full <- read_csv("https://rsacdn.link/milestones/internal/R_community_survey/4wks/data/survey_full.csv")
```

## Survey respondents

`r nrow(survey_full)` people filled out the [2020 R Community Survey](https://github.com/rstudio/r-community-survey). A preview of the dataset is shown below. 


```{r unnamed-chunk-2, results='asis', echo = FALSE}
paged_table(head(survey_full))
```

## How much do you enjoy using R?


```{r plot}
ggplot(survey_full, mapping = aes(x = enjoyability)) +
  geom_bar() + 
  labs(
    x = "Enjoyability Score",
    y = "Count",
    title = "Enjoyability of using R",
    subtitle = "1 = \"don't enjoy it at all\"; 5 = \"enjoy it a great deal\""
  )
```

```{r percent}
enjoy5 <- survey_full %>% 
  filter(enjoyability == 5) %>% 
  nrow()

enjoy5_percent <- enjoy5 / nrow(survey_full) * 100
```

Nearly `r round(enjoy5_percent)`% of respondents enjoy R a "great deal".

## What jobs do R users have?

```{r unnamed-chunk-3}
survey_full %>%
  drop_na(job_category) %>%
  mutate(job_category = fct_lump_n(job_category, n = 10)) %>%
  ggplot(aes(x = fct_infreq(job_category))) +
  geom_bar() +
  labs(
    x = "Job category",
    y = "Count",
  ) +
  coord_flip() 
```

The top three job types are data scientist/analyst, researcher, and student.


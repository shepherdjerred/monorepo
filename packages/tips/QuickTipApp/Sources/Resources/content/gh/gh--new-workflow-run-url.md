---
app: gh
icon: arrow.triangle.branch
color: "#238636"
website: https://cli.github.com
category: New in 2.87
---

- Trigger a workflow and immediately get the run URL printed to your terminal: gh workflow run my-workflow.yml
- No more polling gh run list to find the run that was just triggered
- The URL is printed as soon as the workflow run is created by the GitHub API

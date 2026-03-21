# Academic Sources Reference

Strategies for integrating scholarly literature into deep research via free APIs. Use academic sources for scientific/technical claims, efficacy studies, algorithm descriptions, performance benchmarks, and medical/health topics.

## Semantic Scholar API

Free API, no authentication required for basic access. 1,000 req/sec shared rate limit.

### Paper Search

```bash
curl -s "https://api.semanticscholar.org/graph/v1/paper/search?query=QUERY&fields=title,abstract,citationCount,year,url,authors&limit=10" | jq '.data'
```

Replace `QUERY` with URL-encoded search terms. Key fields: `paperId`, `title`, `abstract`, `citationCount`, `year`, `url`, `authors`.

Sort by relevance (default) or add `&sort=citationCount:desc` for most-cited.

### Citation Graph Traversal

The most powerful technique for finding relevant literature. Given a seed paper, traverse in both directions:

**Forward citations** (papers that cited this one — "who built on this?"):
```bash
curl -s "https://api.semanticscholar.org/graph/v1/paper/{paperId}/citations?fields=title,citationCount,year,url&limit=50" | jq '.data'
```

**Backward references** (papers this one cited — "what did this build on?"):
```bash
curl -s "https://api.semanticscholar.org/graph/v1/paper/{paperId}/references?fields=title,citationCount,year,url&limit=50" | jq '.data'
```

### Traversal Algorithm

1. **Seed**: Find 1-2 highly relevant papers via search (sort by citation count for established topics, by year for emerging ones)
2. **Expand**: Get forward citations AND backward references for each seed paper
3. **Filter**: Keep papers with high citation counts relative to their age, or papers from the last 2-3 years for recency
4. **Repeat**: For the top 3-5 most relevant papers found in step 3, do one more round of traversal
5. **Stop**: After 2 levels of traversal — going deeper rarely adds value and consumes significant context

### Paper Details by ID

```bash
curl -s "https://api.semanticscholar.org/graph/v1/paper/{paperId}?fields=title,abstract,citationCount,year,url,references.title,citations.title" | jq
```

Use DOI, arXiv ID, or Semantic Scholar ID as `{paperId}`. Examples: `DOI:10.1234/example`, `ArXiv:2402.14207`, `CorpusId:123456`.

## arXiv Search

For CS, ML, physics, math, and quantitative fields. Returns XML/Atom feed.

```bash
curl -s "https://export.arxiv.org/api/query?search_query=all:QUERY&max_results=10&sortBy=relevance" | lightpanda fetch --dump --strip_mode full --log_level fatal -
```

Or parse directly:
```bash
curl -s "https://export.arxiv.org/api/query?search_query=all:QUERY&max_results=10&sortBy=relevance"
```

Key fields in response: `<title>`, `<summary>` (abstract), `<id>` (URL), `<published>`, `<author>`.

Category-specific search: `cat:cs.AI`, `cat:cs.CL` (NLP), `cat:cs.LG` (machine learning).

## When to Use Academic Sources

| Research Topic | Academic Source Priority |
|---------------|------------------------|
| Algorithm design, ML/AI techniques | High — arXiv + Semantic Scholar |
| Medical/health claims | High — PubMed + Semantic Scholar |
| Performance benchmarks | High — find the original paper, not blog summaries |
| Software architecture, best practices | Medium — supplement with practitioner sources |
| Product comparisons, tooling | Low — practitioner sources are more current |
| Current events, market trends | Skip — academic publishing is too slow |

## Integration with Research Workflow

During Phase 2 investigation, for each sub-question where academic sources are relevant:

1. Search Semantic Scholar for the most-cited papers on the sub-question
2. Read abstracts of the top 5 results to identify 1-2 seed papers
3. Traverse the citation graph 1-2 levels from seed papers
4. Extract key claims with paper titles and years as citations
5. Cross-reference academic findings with practitioner sources (GitHub, HN, blog posts) to check real-world applicability

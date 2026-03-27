# Evidence Standards Reference

Standards for confidence scoring, source quality assessment, cite-then-write discipline, and contrasting evidence gathering. These standards prevent hallucination and ensure reports accurately convey certainty levels.

## Source Quality Tiers

Every source encountered during research must be assigned a tier:

| Tier   | Definition                                                                                                     | Examples                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | Peer-reviewed, official documentation, primary data, authoritative first-party sources                         | Journal papers, official API docs, RFC specifications, government data, project READMEs by maintainers, Wikipedia (for established concepts)                              |
| **T2** | Established media, named authors with credentials, well-maintained repositories, detailed independent analysis | Named-author blog posts with working code/benchmarks, established tech media (InfoQ, Ars Technica), GitHub repos with 100+ stars and active maintenance, conference talks |
| **T3** | Anonymous, undated, unverifiable, community commentary, marketing materials                                    | Unsigned blog posts, forum comments, HN comments (unless from identified domain experts), product marketing pages, undated articles, content-farm style posts             |

**Resolution rule**: When T1 and T2/T3 sources disagree on a factual claim, prefer the T1 source. When two T1 sources disagree, present both positions as contested.

## Confidence Scoring Rubric

Assign confidence to each factual claim in the report:

### High Confidence

- 2+ independent T1 or T2 sources agree on the claim
- Primary source data directly supports the claim
- No credible contradicting sources found
- **Language**: State as fact. "X does Y." "The system uses Z."

### Medium Confidence

- Single strong (T1/T2) source supports the claim
- 2+ T3 sources agree, with no contradiction from higher-tier sources
- Claim is plausible and consistent with other findings but not independently verified
- **Language**: Hedge appropriately. "According to [source], X does Y." "Evidence suggests that Z." "Based on [source]'s analysis, ..."

### Low Confidence

- Single T3 source, or conflicting evidence across sources
- Extrapolation from related findings rather than direct evidence
- The claim is plausible but could not be verified
- **Language**: Flag explicitly. "One source claims X, though this could not be independently verified." "Preliminary evidence indicates Y, but further investigation is needed."

### Insufficient Evidence

- No credible source supports the claim, or all sources are contradictory
- **Action**: Do NOT speculate. State directly: "Insufficient evidence was found to determine X." Move to the Open Questions section rather than making a weak claim.

## Cite-Then-Write Procedure

This is the core hallucination prevention mechanism. Claims are written FROM findings, not generated and then cited post-hoc.

### For each report section:

1. **Gather**: Pull all findings from the running findings list that are relevant to this section. Each finding should already have a source number.
2. **Arrange**: Order findings into a logical narrative flow (chronological, importance, or causal).
3. **Write**: Compose prose that connects the findings. Every factual sentence must reference a finding with its source number inline.
4. **Verify**: After writing the section, check each factual sentence:
   - Does it trace to a specific finding in the findings list? → Keep it.
   - Is it a reasonable inference clearly labeled as such? → Keep it with hedging language.
   - Is it an unsourced claim generated during writing? → Either find a source via targeted search, or remove it.
5. **Flag**: Any claim that needed a new search in step 4 gets a confidence reassessment.

### Common cite-then-write violations to avoid:

- Writing a narrative first, then hunting for citations to support it
- Paraphrasing a source so loosely that the citation misrepresents it
- Citing a source for claim X when the source actually discusses claim Y
- Using a single source's framing as if it were consensus

## Contrasting Evidence Search Patterns

After finding supporting evidence for a claim, actively search for opposition:

### Search templates:

- `"[topic] criticism"` or `"[topic] problems"` or `"[topic] limitations"`
- `"[topic] vs [alternative]"` to surface comparison discussions
- `"why not [topic]"` or `"[topic] considered harmful"`
- On HN: check comments on positive articles — dissenting views often surface in replies

### For academic claims:

- Search Semantic Scholar for papers that cite the original but may disagree
- Check if the paper has been replicated or challenged
- Look for systematic reviews or meta-analyses that may contextualize the claim

### Integration into findings:

When contrasting evidence is found, record it alongside the supporting evidence:

```
Finding: [claim] (source: [N])
Contrasting: [counter-claim or limitation] (source: [M])
Confidence: [adjusted level based on disagreement]
```

If no contrasting evidence is found after a reasonable search, note this — it strengthens confidence in the claim.

## Evidence Sufficiency Matrix

Minimum evidence thresholds before a claim can appear as a finding (not an open question):

| Claim Type                            | Minimum for Finding                                 | Ideal                                           |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| Quantitative data (benchmarks, stats) | 1 T1 primary source                                 | 2+ independent measurements                     |
| Architecture/design claims            | 1 T1/T2 source (official docs or detailed analysis) | Official docs + practitioner confirmation       |
| Community sentiment                   | 3+ independent comments/discussions                 | 10+ across multiple platforms                   |
| Best practice recommendations         | 2+ T1/T2 sources agreeing                           | Consensus across 3+ sources + no strong dissent |
| Emerging trend                        | 2+ recent T2 sources                                | Pattern across 3+ independent indicators        |

---
title: Dares reference
description: Free challenges, consent, evidence, and results in Scout.
sidebar:
  order: 16
---

Dares challenge tracked players to observable in-game achievements. They are available in the existing beta servers.

| Surface                  | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `/dare text:<challenge>` | Start a private draft conversation in Explore            |
| Dares in the web app     | View drafts, published contracts, progress, and evidence |
| Dares settings           | Choose lifecycle and progress direct messages            |
| Explore                  | Author and revise the challenge conversationally         |

| State                          | Meaning                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| Draft                          | Private to the challenger; editable and deletable                       |
| Pending acceptance             | Published by the challenger; targets have 24 hours to respond           |
| Activating                     | All targets accepted; required starting observations are being captured |
| Active                         | Eligible match evidence is being evaluated                              |
| Achieved / unachieved          | The frozen contract has a final result                                  |
| Voided                         | Required evidence cannot establish the result                           |
| Declined / expired / cancelled | The challenge ended before activation                                   |

Canonical SQL is the binding contract. A revision freezes its targets, deadline, eligibility, and plain-language description. Historical previews use only recorded data and identify missing coverage.

Dares carry no stakes, contributions, currency, fees, or payouts. Publishing requires confirmation by the challenger; accepting requires confirmation by each target. Confirmation cards expire after ten minutes and execute once.

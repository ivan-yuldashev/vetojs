---
"@vetojs/core": patch
---

**Checks are two to five times faster, with the same answers.**

Rules are grouped by resource and action the first time that pair is asked about, a `where` is compiled into a function on first use, and a check stops as soon as its verdict is fixed — at the first grant when the pair carries no prohibition.

Measured on the benchmark that compares both engines, published bundle against published bundle: against a 222-rule policy one check goes from 90k to 549k a second when nothing matches, and from 83k to 515k when the matching rule sits last; on a twelve-rule policy a miss goes from 1.7M to 4.2M and a match from 1.7M to 2.7M.

Building an ability now takes a copy of the policy, so the rules are read once: changing the array or a rule object afterwards no longer changes some answers and not others. Building a 222-rule policy on its own drops from 10M a second to 5M; a build followed by a check is unchanged, the copy being smaller than the first grouping. Nothing is grouped or compiled until something is asked.

The relations a policy reads are gathered per resource and action, and a check reads them once before weighing any rule. A forgotten `include` therefore raises `RelationNotLoadedError` whatever the order of the rules and whichever rule would have settled the row — including when a `deny` settles it.

The cost is 0.7 kB gzipped: a check with trusted rules bundles at 3.8 kB rather than 3.1.

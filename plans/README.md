# Plans

Specs describe **state** — what should be true of remarkable-axi, forever. Plans
describe **motion** — how we are getting there next.

Every chunk of work starts as a file here declaring its scope, the specs it
implements, its dependencies on other plans, and concrete validation criteria. Those
files form a micro-DAG that is the project's working plan. Once merged, a plan freezes
as historical record: its merged-PR link plus its completed validation criteria are
how the project remembers what got built and what was deferred.

The full protocol — frontmatter schema, body template, status lifecycle, the closeout
commit, and the follow-ups taxonomy — is in the vendored **specops** skill at
`.claude/skills/specops/references/plans-protocol.md`. Read it before authoring or
closing out a plan.

This file deliberately holds no DAG drawing and no status table; both rot the moment
someone forgets to update them. Query the authoritative frontmatter instead:

```sh
.claude/skills/specops/scripts/specops          # dashboard
.claude/skills/specops/scripts/specops next     # what to work on
.claude/skills/specops/scripts/specops dag      # graph
```

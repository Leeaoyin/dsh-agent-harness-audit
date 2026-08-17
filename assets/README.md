# assets

Diagrams are hand-written SVG so they stay diffable and editable, and they
carry a `prefers-color-scheme` block so they read on GitHub's light and dark
themes alike.

| File | Kind | Used in |
|---|---|---|
| `pipeline.svg` | diagram | How a run works |
| `validation.svg` | diagram | Evidence validation |
| `results.svg` | diagram | Does it work? |
| `picker.png` | screenshot | Use — the dimension picker |
| `announce.png` | screenshot | Use — the start notice and confirmation |
| `subagents.png` | screenshot | How a run works — one subagent per check |

Screenshots come from a real run against a real codebase; retake them rather
than editing them when the interface changes.

## When a check is added or renamed

The README check tables are generated from `src/checks.ts` and `src/i18n.ts`
between the `<!-- checks:start -->` and `<!-- checks:end -->` markers in both
`README.md` and `README.zh.md`. Regenerate rather than hand-editing, so the
docs cannot drift from the code.

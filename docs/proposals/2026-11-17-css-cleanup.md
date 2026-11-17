# CSS cleanup: one order, no dead rules

## Problem

`web/src/index.css` is 2202 lines / 46 KB source, 104 KB (18 KB gz) in the
bundle. It is not broken, it is unreadable and it drifts:

- 12 `@layer` blocks, 6 of them `@layer components`, at offsets 11.6k, 23.6k,
  31.8k, 38.3k, 43.4k, 45.1k. The same rule lands in different blocks depending
  on when it was written, so cascade order is decided by where a line happens to
  sit, not by intent.
- 369 rules, 235 distinct class selectors, 66 custom properties, 44
  `@keyframes`.
- `.markdown` alone appears 38 times, `.compaction-summary` 15, `.row-sheen-*`
  30 across three names. Changing one surface means grepping the whole file.
- Hand-written rules duplicate what a Tailwind utility already produces (the
  last audit found six such classes, they were removed, more remain).

Every new visual tweak is therefore a small archaeology exercise, and a
wrong-order edit silently wins over a Tailwind class.

## Smallest change

Four commits, each one verifiable on its own. No selector rewrites, no new
files, no new tooling.

1. **One order.** Merge the six `@layer components` blocks into one and sort the
   rules inside it by surface: base and variables, layout, chrome (header,
   sidebar, composer), transcript, markdown, dialogs, animations,
   `prefers-reduced-motion` last. Keep every declaration byte-identical. Check:
   `bin/previews` output matches the previous four PNGs, `index.css` rule count
   and gzip size unchanged.
2. **Dead rules.** For each class selector, grep `web/src/**/*.tsx`. Delete the
   rule and its keyframes when the class is used nowhere (the first pass already
   took 6 names and ~100 lines). Batch at 10 rules per commit.
3. **Duplicated utilities.** For selectors whose body is one to three plain
   utilities used on a single element, move the utilities into `className` and
   delete the rule. Stop when the remaining selectors are layout, animation or
   something Tailwind cannot express. Roughly ten rules per commit.
4. **Keyframes.** Grep each of the 44 `@keyframes` names in TS and CSS; delete
   the unused ones together with their `animation` references.

## Acceptance check

- `bin/check` green (it builds the CSS).
- `web/dist/assets/index-*.css` gzip is not larger than today's 18.1 KB.
- `bin/previews` regenerates four thumbnails identical to today's: no shift in
  header, sidebar, transcript, markdown table, code fence.
- Manual: open settings, theme picker, review sheet, composer with a long draft;
  no missing background, border or animation.
- Grep: no class selector in `index.css` has zero matches in `web/src/**/*.tsx`.

## Risks

- Reordering the cascade can flip an override that currently depends on source
  order. That is why step 1 is byte-only and checked against the four previews
  before any deletion.
- Deleting a class that is referenced from a string (`className={"x " + y}`) is
  easy to miss: grep must include template literals and `cn(` arguments, not
  only `className="`.
- The whole job is cosmetic; if the file is not blocking a change, it can wait.

## What not to do

- Do not split CSS into per-component files: the cascade is the hard part, and
  twelve small files with an import order is the same problem with more places
  to look.
- Do not add a CSS-in-JS layer or a component library for this.

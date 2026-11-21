# Weekly Insights post guide

One post is published most Mondays. Each one should help a UK marketing leader, or an in-house PPC manager, make a better Google Ads or paid search decision this week. Alternate the angle: roughly one post in three should be written for in-house PPC teams (what to test, how to brief leadership, how to plan a change), ending with a link to /ppc-teams/.

## Choosing the topic

1. Look at what changed in the last 7 to 10 days: Google Ads & Commerce blog, Google Ads Help release notes and help-page changes, Google Ads Editor release notes, Microsoft Advertising blog, Search Engine Roundtable, Search Engine Land, PPC Land.
2. Pick the change with the biggest effect on budget, measurement, bidding or automation decisions for UK advertisers spending roughly £25k to £100k a month.
3. If nothing meaningful changed, write an evergreen note tied to one of the decisions Second Query helps with: a new Head of Performance, changing agency, bringing PPC in-house, a budget step-up, switching on a new campaign type or bidding strategy, or an in-house team planning a restructure, a test or next year's budget case.
4. Don't repeat a topic already covered in `content/posts/` unless there is a genuine update, and then link to the earlier note.

## Rules

- Every factual claim about a platform change must come from a source read that week. Prefer Google's or Microsoft's own pages; use trade press for context. List every source in the `sources` front matter.
- Never state a date, number or rollout detail that the sources don't support. If timing is unconfirmed, say so.
- Never mention, hint at or draw on any client, employer or account Sam works on. No "one of our clients" stories.
- No prices in posts beyond linking to /services/.
- Paraphrase sources. At most one short quote (under 15 words) per source.

## Voice

- Sam writing in the first person: senior, plain, calm and a little wry. UK English.
- Short paragraphs, clear subheadings, one practical list.
- No hype, no "game-changer", no emoji, no em dashes (use commas, colons or full stops).
- 500 to 800 words. End with a short "bottom line" or a question a leader should ask their team or agency.

## Format

File: `content/posts/YYYY-MM-DD-slug.md`, dated the Monday of publication. Tags: two or three from AI Mode, AI Max, Search, Performance Max, Shopping, Smart Bidding, Measurement, Budgets, Automation, Leadership, Microsoft Ads, UK. Run `python3 build.py` before committing to check it builds.

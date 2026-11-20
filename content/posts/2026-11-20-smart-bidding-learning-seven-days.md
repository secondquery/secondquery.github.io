---
title: The "Learning" label now ends after seven days. The learning doesn't
description: Google has rewritten its Smart Bidding learning guidance. The visible status now caps at seven days, but calibration can take around 50 conversions or three conversion cycles.
date: 2026-11-20
tags: Smart Bidding, Budgets
query: smart bidding learning period how long
sources:
  - [Google Ads updates Smart Bidding learning doc with 7-day limit (Search Engine Roundtable, 21 October 2026)](https://www.seroundtable.com/google-ads-updates-smart-bidding-doc-42345.html)
  - [About Smart Bidding learning (Google Ads Help)](https://support.google.com/google-ads/answer/13020501)
  - [Learning phase explained (PPC Land)](https://ppc.land/learning-phase/)
---
In October, Google rewrote its help page on Smart Bidding learning. The old article was called "Duration of the learning period for campaigns and what affects it". It's now "About Smart Bidding learning", and the content changed with it.

Two points matter for anyone making budget or target decisions.

## 1. The status and the learning are now separate things

Search Engine Roundtable reported that the new page explicitly separates the visible "Learning" status from the time it takes bidding performance to settle, and says the status never lasts more than seven days.

That's helpful, but it creates a trap. A campaign can drop the "Learning" label after a week while the bid strategy is still calibrating. If someone reads the label as "it's done, we can judge it now", they may judge it too early.

## 2. The real clock is conversions, not days

Google's guidance says calibrating to a new objective can take up to around 50 conversion events or three conversion cycles, though it can be faster for some accounts. A conversion cycle is the usual gap between a click and a conversion.

For a high-volume account, 50 conversions might take a few days. For a B2B account generating eight leads a month, it could take most of a year. The same seven-day label means very different things.

Try it with your own numbers:

<div class="lclock">
<div class="lcin">
<label>Conversions a week, for this campaign<span><input type="range" min="1" max="120" value="12" class="lc-rate" aria-label="Conversions a week"><output class="lc-rate-out">12</output></span></label>
<label>Typical days from click to conversion<span><input type="range" min="0" max="30" value="3" class="lc-lag" aria-label="Days from click to conversion"><output class="lc-lag-out">3</output></span></label>
</div>
<div class="lcdots" aria-hidden="true"></div>
<p class="lcresult" aria-live="polite"></p>
</div>

## What this changes in practice

**Budget step-ups.** If you're planning to add a lot of budget, change it in steps and judge each step on conversions collected, not days passed. Put the step dates in the calendar so nobody changes targets mid-way.

**Target changes.** Changing a target return on ad spend or cost per acquisition restarts calibration. Agree who can change targets, and how often, before the busy season, not during it.

**Agency reviews.** If you're judging an agency or a new strategy, check how many conversions each campaign has collected since its last significant change. A "bad month" on a campaign that changed three weeks ago with 20 conversions isn't evidence of much.

**Low-volume accounts.** If you can't realistically reach around 50 conversions in a sensible period, consider bidding to a higher-volume conversion that still predicts value, or consolidating campaigns so each one learns faster.

## A useful habit

For every significant bidding change, write down three things: the date, what changed and how many conversions the campaign usually gets in a week. It takes a minute, and it turns most "is it working yet?" conversations into simple arithmetic.

# Forecast Journal for Obsidian

**Log predictions with probabilities, score them with the Brier score, and find out whether your judgment beats your baseline.**

Planners, investors and anyone who makes calls under uncertainty say "I think X will happen" all the time and rarely check. This plugin turns those calls into a scored record inside your vault.

## What it does

- **Log a forecast** (command palette): question, your probability, an optional **baseline** (base rate, model output, market price), resolve-by date, tags and reasoning. Each forecast is a normal note with YAML frontmatter in a `Forecasts/` folder, so it links, searches and syncs like everything else.
- **Resolve due forecasts**: one click per forecast, yes, no or void.
- **Calibration view** (ribbon icon): Brier score, skill versus always saying 50%, a reliability chart (did your 70% calls come true 70% of the time?), over- or under-confidence, and the list of forecasts due.
- **Value added vs baseline**: on forecasts where you recorded a baseline, the difference between the baseline's Brier score and yours. Positive means your judgment improved on the number you started from. It is forecast value added, applied to your own head.
- **Embed stats anywhere** with a code block:

  ````
  ```forecast-journal
  tag: markets
  ```
  ````

## Forecast note format

```yaml
---
type: forecast
question: "Will the Bank of Canada cut rates at its next meeting?"
probability: 0.35
baseline: 0.5
created: 2026-10-01
resolve_by: 2026-10-29
outcome:          # yes | no | void, set when resolved
resolved_on:
tags: ["macro"]
---
```

## Scoring

- Brier score = mean of (probability − outcome)², outcome 1 for yes and 0 for no. 0 is perfect; 0.25 is what always saying 50% earns.
- Skill = 1 − Brier / 0.25.
- Overconfidence = average, weighted by bin size, of how far your forecasts sit from 50% minus how far outcomes sit from 50%. Positive: your probabilities are more extreme than your hit rate supports.

## Install

Until it is in the community plugin list: download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/forecast-journal/`, then enable it. Development: `npm install && npm run dev`.

By [Sachet Mulimani](https://github.com/msachet5), also the author of [UltiSync](https://github.com/msachet5/obsidian-ultisync) and [forecast-value-added](https://github.com/msachet5/forecast-value-added). MIT licensed.

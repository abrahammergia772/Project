# Training the audit models — start here

You went looking for a dataset and could not find one. That is the correct
outcome: **the dataset you need does not exist anywhere on the internet**, and
for most of what BuildIQ needs, no dataset is required at all.

This document explains what to do instead. Read it before running anything.

---

## 1. Two different problems are hiding under "audit AI"

| | What it does | Needs ML? | Needs a dataset? |
|---|---|---|---|
| **Type classification** | Which of the 7 audit types is this event? | **No** | **No** |
| **Anomaly scoring** | Is this event unusual for this person? | Yes | **Your own logs** |

### Type classification needs no model

Every action code maps to exactly one audit type, by definition:

```
LOGIN_FAILED  -> SECURITY        BUDGET_MODIFY -> FINANCIAL
BULK_DELETE   -> USER_ACTIVITY   EXPORT_DATA   -> REPORT_DOCUMENT
```

That is `ACTION_TO_TYPE` in `app/ai_engine.py` — 36 codes, 7 types, a
dictionary lookup with 100% accuracy. Training a classifier to reproduce a
lookup table is strictly worse than the lookup table: slower, occasionally
wrong, and impossible to explain to an auditor. **Do not train a model for
this.**

A model only helps here if you want to classify *free text* — an inspector
typing "concrete pour on level 3 was not signed off" and the system deciding
that is COMPLIANCE. That is a real ML problem, and it needs a different kind
of data (labelled sentences), covered in §5.

### Anomaly scoring is where a model belongs

"Is this event unusual?" genuinely depends on patterns nobody can hand-write.
But look at what the current engine actually computes:

```python
base = (0.45 if action in HIGH_RISK_ACTIONS else 0.08) + (0.28 if odd_hours else 0)
```

Across all 36 actions and all 24 hours, this produces exactly **four**
distinct scores: `0.17, 0.45, 0.54, 0.82`. It has no idea who the user is,
what they normally do, or how often they do it. A finance manager approving
their 40th payment of the month scores identically to an intern approving
their first.

That is the thing worth replacing, and it is what this directory does.

---

## 2. Why public datasets will not work

The best-known option is **CERT r4.2** from Carnegie Mellon — 1000 synthetic
users, 17 months, ~32.7 million events, and the standard benchmark in insider
threat research. It is genuinely good data. It is also useless here:

- Its events are `logon`, `email`, `http`, `device`, `file`. Yours are
  `MATERIAL_OVERUSE`, `EQUIPMENT_UNRETURNED`, `MILESTONE_DELAY`,
  `APPROVAL_BYPASS`. **There is no overlap** with 4 of your 7 audit types.
- It models an office, not a construction firm. No projects, no site
  departments, no material ledgers, no attendance register.
- Its roles are not your roles. Nothing in it knows what a Department
  Manager may or may not do.

A model trained on CERT would learn office-worker behaviour and then be asked
to judge whether an Ethiopian construction engineer logging equipment at
06:30 is suspicious. It is not — that is the start of a site shift. CERT would
flag it, because in an office 06:30 is odd. **A model trained on the wrong
population is worse than no model**, because it produces confident, wrong
answers that an auditor will act on.

The same applies to every public alternative (SPEDIA, LANL, UNSW-NB15): they
are network/host security datasets, not construction ERP audit trails.

---

## 3. What to do instead: bootstrap from your own logs

You already have the only correct data source — `audit_logs` in your own
database. Every action anyone takes is written there by `record_audit()`.
This directory turns that into a trained model:

```
ml/
  extract.py    pull audit_logs out of Postgres into a CSV dataset
  features.py   turn raw events into behavioural features
  train.py      fit the model, print honest metrics, save artifacts
  synth.py      generate a realistic cold-start dataset (no history needed)
  evaluate.py   check a trained model against held-out data
  artifacts/    trained models land here (git-ignored)
```

### The cold-start problem, and the honest answer

You have ~84 seeded log rows. That is not enough to train anything — you need
roughly **10,000+ events across 30+ days** before per-user baselines mean
anything.

There are two paths, and I want to be blunt about the difference:

**Path A — run first, train later (recommended).**
Ship the rule engine you already have. It is crude but it is *honest*: nobody
will mistake four hard-coded thresholds for intelligence. Let the system
accumulate real logs for 4–8 weeks, have your Auditor use the existing
Confirm Threat / False Alarm buttons (those verdicts are your **labels** — see
§4), then run `train.py` on real data.

**Path B — synthetic data now.**
`synth.py` generates a construction-shaped dataset using your real taxonomy,
roles and departments. This is useful for **building and testing the
pipeline**, and for demonstrating the system.

> **Be honest about what Path B is.** A model trained on synthetic data has
> learned the assumptions I wrote into the generator, not facts about your
> organisation. It will score well on synthetic test data because both halves
> came from the same generator — that number is *not* evidence the model
> works. `train.py` prints this warning on every synthetic run, and the
> artifact is tagged `"provenance": "synthetic"` so it cannot be mistaken for
> a real one. Use it to prove the plumbing works. Do not put it in front of an
> auditor as a finding.

---

## 4. You already have a labelling mechanism (use it)

This is the most valuable thing in this document.

`POST /audit/feedback` already records reviewer verdicts:

| Button | Stored `review_status` | Means |
|---|---|---|
| Confirm Threat | `Confirmed Threat` | genuine anomaly — **positive label** |
| False Alarm | `False Alarm` | engine was wrong — **negative label** |
| Suspend / Revoke | `Confirmed Threat` | genuine, acted upon |

Every time your Auditor clicks one of those, they are hand-labelling a
training example — for free, as part of their normal job. After a few months
that is a **real, correctly-distributed, domain-specific labelled dataset for
your actual organisation**, which is exactly the thing you could not find
online and could never have bought.

Nothing currently uses it. `train.py --supervised` does.

Tell your Auditor that clicking False Alarm is not just dismissing a popup —
it is teaching the system. That single behavioural change is worth more than
any public dataset.

---

## 5. If you do want text classification

To classify free-text complaint/inspection notes into the 7 types, you need
labelled sentences. Cheapest route, in order:

1. **Bootstrap with your existing engine.** `classify_complaint()` in
   `ai_engine.py` already keyword-classifies complaints. Run it over your
   complaint history, have someone correct the output — correcting is ~5x
   faster than labelling from scratch.
2. **Use the LLM you already pay for.** You have Groq configured. Ask
   `llama-3.3-70b` to label a few thousand historical notes, then have a human
   spot-check ~200. This is "LLM-as-annotator" and it is now standard practice.
3. **Then** fine-tune a small model, or just keep using the LLM if volume is
   low — at your scale the LLM is probably cheaper than maintaining a model.

Target: ~200 examples per type minimum (1400 total), ideally 500+.

---

## 6. Quick start

```bash
pip install -r requirements-ml.txt

# Path B: synthetic, to see the whole pipeline work end to end
python ml/synth.py --days 90 --users 40 --out ml/data/synthetic.csv
python ml/train.py --data ml/data/synthetic.csv

# Path A: your real logs, once you have some
python ml/extract.py --out ml/data/real.csv        # reads DATABASE_URL
python ml/train.py --data ml/data/real.csv
python ml/train.py --data ml/data/real.csv --supervised   # uses reviewer verdicts
```

Nothing here is wired into the running API. Training is offline and optional;
the app keeps using the rule engine until you explicitly load an artifact.

# train_model — free-text audit type classifier

Sorts a human-written note into one of the seven BuildIQ audit types.

| File | What it is |
|---|---|
| `audit_types_hard_dataset.csv` | 5,250 labelled notes, 750 per type |
| `buildiq_audit_type_classifier_hard.joblib` | TF-IDF + LogisticRegression pipeline |
| `train_audit_type_classifier.py` | reproduces and evaluates the model |

## What this does, and what it does not

This handles **free text** — a complaint body, an inspection remark, an
imported note — where no lookup is possible:

```
"measurement sheet deleted, no change order"  ->  DATA_INTEGRITY  (0.95)
"failed login attempt from new ip"            ->  SECURITY        (0.99)
```

It is **not** used for structured events. An action code already maps to
exactly one audit type by definition (`ACTION_TO_TYPE` in
`app/ai_engine.py`): `BULK_DELETE` is always `USER_ACTIVITY`. That is a
dictionary lookup with 100% accuracy, and a model there could only be slower
and occasionally wrong.

## How good is it, honestly

Measured on a **grouped** split — identical texts never appear on both sides,
so nothing is scored on strings it memorised:

| | |
|---|---|
| Held-out accuracy | **91.7%** |
| Achievable ceiling | **96.3%** |
| Guessing baseline | 14.3% |

That 96.3% is not a typo. **125 texts in the dataset carry contradictory
labels** — `"flagged item"` appears under all seven types, `"data issue"`
under six. No model can be right about all of them, so 96.3% is the maximum
any classifier could score. At 91.7% this model reaches **95.3% of what is
achievable**, which is a strong result.

Two consequences worth knowing:

- **Anyone reporting 99% on this dataset has leaked their test set.** Scoring
  the model on rows it trained on gives 91.8%, and a random split gives 90.7%
  — both are the same model, differently measured.
- **Low confidence usually means the text is genuinely ambiguous**, not that
  the model failed. That is why every prediction carries a confidence and an
  `is_confident` flag rather than just a label.

Weakest class is `REPORT_DOCUMENT` (recall 0.892); add examples there first
if you extend the dataset.

## Where it is wired in

| Integration | Behaviour |
|---|---|
| `POST /audit/classify` | classify any text; returns type, confidence, top-3 alternatives |
| `GET /audit/classifier-status` | whether the model is live or the fallback is running |
| `POST /complaints` | every new complaint is auto-tagged with `audit_type` |

The complaint tagging is the real payoff: free-text complaints and structured
audit events now share a dimension, so the audit dashboard can count them
together.

**The model never blocks the API.** `app/services/audit_classifier.py` loads
it lazily and falls back to a keyword heuristic if scikit-learn is missing,
the file is absent, or the artifact was built by an incompatible library
version. scikit-learn is deliberately *not* a runtime dependency — the
deployed service does not install it, so in production the keyword fallback
is what actually runs unless you add it.

> To run the real model on Render, add `scikit-learn` and `joblib` to
> `requirements.txt`. That costs roughly 100 MB of build and slower cold
> starts. Given the fallback handles obvious cases and the model mainly wins
> on ambiguous ones, this is a judgement call — measure before paying for it.

## Retraining

```bash
pip install -r ../buildiq-backend/requirements-ml.txt
python train_audit_type_classifier.py
```

The script prints the ceiling next to the score, so results are always read
against what is achievable rather than against 100%. It refits on the full
dataset before saving, but reports the held-out number.

## Extending the dataset

Append rows with the same three columns (`text,audit_type,source`). Use a new
`source` value so synthetic and real data stay distinguishable — everything
here is currently `hard_synthetic_v2`, which means it was written to look
like your domain rather than collected from it.

The best data you can add is **real**: your own complaint history, labelled
by whoever triages it. Correcting the model's guesses is roughly five times
faster than labelling from scratch, and `POST /audit/classify` gives you the
guess to correct.

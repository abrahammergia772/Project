# Using Groq — and how the AI reads your database

## Your API right now

```
ai_provider: heuristic     ← no AI is running
```

Replies are the built-in rule-based fallback, which is why the chatbot answers
generically instead of naming your projects.

**Cause:** `AI_PROVIDER=openai_compatible` is set on Render, but `AI_BASE_URL`
and/or `AI_API_KEY` are missing. That setting *overrides* Groq, so your
`GROQ_API_KEY` is being ignored.

---

## Fix — use Groq (simplest, you already have the key)

Render → **Constructionai → Environment → Edit**:

| Key | Action |
|---|---|
| `AI_PROVIDER` | change to `groq` — or **delete the variable entirely** |
| `GROQ_API_KEY` | keep (must be a real key from console.groq.com) |
| `AI_BASE_URL` | delete (unused by Groq) |
| `AI_API_KEY` | delete (unused by Groq) |
| `AI_MODEL` | delete (unused by Groq) |

**Save changes** → redeploys in ~2 min.

Confirm:

```bash
curl https://constructionai-q9er.onrender.com/health
```

Want `"ai_provider": "groq (llama-3.3-70b-versatile)"`, not `"heuristic"`.

### Or use OpenRouter instead

Keep `AI_PROVIDER=openai_compatible` and fill in **all three**:

```
AI_BASE_URL = https://openrouter.ai/api/v1
AI_API_KEY  = sk-or-v1-...
AI_MODEL    = openai/gpt-oss-20b:free
```

All four are required together — a partial set gives you exactly the
`heuristic` state you have now.

---

## How the AI reads your database

It does **not** connect to Postgres, and it cannot run SQL. That is
deliberate: an LLM issuing its own queries could read rows the signed-in user
is not allowed to see, and could be talked into it by a crafted message.

Instead, on every question the backend:

1. queries Supabase itself, through the **same role-scoped functions the rest
   of the app uses** (`visible_projects`, `visible_complaints`,
   `visible_members` in `app/deps.py`);
2. formats the rows into a compact text digest;
3. sends that digest to Groq alongside the question.

So the model only ever sees data the user could already open in the UI:

| Role | What the AI can discuss |
|---|---|
| Super Admin / General Manager | Every project, complaint and member |
| Auditor | Everything, read-only |
| Department Manager | Their department only |
| Project Manager | Projects they manage |
| Engineer | Projects they work on |
| Client | Their own projects and complaints |

A Department Manager cannot ask the chatbot about another department's
projects — the rows are never in the prompt.

### What it can and cannot answer today

Included: **projects** (progress, expected progress, delay risk, manager),
**complaints** (category, severity, status, department) and **members** (role,
department, job title).

Not included: tasks, attendance, audit logs, documents. Ask about those and it
will say it doesn't have the data. If you want any of them added, say which —
it is a small change to `_scoped_context()` in `app/routers/ai.py`.

### Prompt size

Projects are capped at 12 in the digest, with "…and N more" appended. Free
tiers have tight token limits, and an unbounded prompt would eventually fail.
On a large portfolio the model sees a sample, not the full list.

---

## Where AI is used

Six surfaces, all with the same behaviour: if Groq is unavailable or the call
fails, the feature silently falls back to deterministic rules rather than
erroring.

- Chatbot and the floating assistant
- Project risk explanations
- Complaint classification and routing
- Suggested complaint resolutions
- Report narratives
- Executive summaries

`ai_source` in each response tells you which produced it: `"groq"` or
`"heuristic"`.

---

## Tuning

| Variable | Default | Notes |
|---|---|---|
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Any Groq chat model |
| `GROQ_MAX_TOKENS` | `700` | Longer replies cost more tokens |
| `GROQ_TEMPERATURE` | `0.4` | Lower is more factual |
| `GROQ_TIMEOUT_SECONDS` | `20` | On timeout it falls back |
| `AI_ENABLED` | `true` | `false` forces heuristics everywhere |

These apply to whichever provider is active — the `GROQ_` prefix is
historical.

---

## Rate limits

Groq's free tier is per-model, typically a few thousand requests/day. Hitting
the limit is not an outage: those requests fall back to the heuristics and
`ai_source` reports `"heuristic"`. Watch for that if replies suddenly become
generic.

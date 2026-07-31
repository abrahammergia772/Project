# Using a different (or free) AI provider

BuildIQ's AI features — chatbot, project risk analysis, complaint routing,
anomaly detection, task prioritisation, executive summaries — run on Groq by
default. You can point them at **any provider with an OpenAI-compatible
`/chat/completions` endpoint** by changing environment variables only. No code
changes.

If no provider is configured, or a provider fails, every feature falls back to
the built-in deterministic heuristics. The app never breaks because an AI
service is down.

---

## Switching provider

Set four variables on your Render **API** service:

| Key | Value |
|---|---|
| `AI_PROVIDER` | `openai_compatible` |
| `AI_BASE_URL` | provider base URL (see table) |
| `AI_API_KEY` | your key from that provider |
| `AI_MODEL` | model id from that provider |

Save → Render redeploys → check `/health`:

```json
{ "ai": "groq", "ai_provider": "openrouter.ai (deepseek/deepseek-r1:free)" }
```

`ai_provider` tells you which provider and model is actually serving requests.
`"heuristic"` means nothing is configured and the local fallback is in use.

> The `ai` field still reads `"groq"` when any provider is live — it means
> "an LLM is available", not the vendor. `ai_provider` is the precise one.

---

## Free providers

| Provider | `AI_BASE_URL` | Example `AI_MODEL` | Free tier |
|---|---|---|---|
| **OpenRouter** | `https://openrouter.ai/api/v1` | `deepseek/deepseek-r1:free` | 20 req/min, 50 req/day |
| **Cerebras** | `https://api.cerebras.ai/v1` | `gpt-oss-120b` | 5 req/min, 1M tokens/day |
| **Google AI Studio** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | Generous; trains on data outside UK/EEA |
| **Scaleway** | `https://api.scaleway.ai/v1` | varies | 1M free tokens |
| **Groq** *(default)* | — leave `AI_PROVIDER=groq` | `llama-3.3-70b-versatile` | Per-model limits |

Model ids change often. Check the provider's `/models` endpoint or dashboard
for current names rather than trusting the examples above.

### OpenRouter — the easiest free option

1. Sign up at <https://openrouter.ai>, create a key under **Keys**
2. Pick any model whose id ends in `:free`
3. Set:

```
AI_PROVIDER = openai_compatible
AI_BASE_URL = https://openrouter.ai/api/v1
AI_API_KEY  = sk-or-v1-...
AI_MODEL    = deepseek/deepseek-r1:free
```

---

## Test before deploying

```bash
cd buildiq-backend
AI_PROVIDER=openai_compatible \
AI_BASE_URL=https://openrouter.ai/api/v1 \
AI_API_KEY=sk-or-v1-... \
AI_MODEL=deepseek/deepseek-r1:free \
ALLOW_SQLITE=true DATABASE_URL=sqlite:///./tmp.db SECRET_KEY=x \
python3 -c "
from app.services import groq_service
print(groq_service.complete('You are terse.', 'Say OK'))
"
```

`OK` (or similar) means it works. `None` means the call failed and the app
fell back — the reason is logged, usually a bad key or a wrong model id.

---

## Going back to Groq

Set `AI_PROVIDER=groq`. The `AI_*` variables are ignored.

## Turning AI off entirely

Set `AI_ENABLED=false`. Everything keeps working on the heuristics: risk
scores, anomaly detection and complaint routing are all rule-based
underneath, just not LLM-phrased.

---

## What stays the same

- **Rate limits are the provider's**, not BuildIQ's. On a free tier a burst of
  chatbot use can hit them; requests then fall back to heuristics rather than
  erroring.
- **Timeout, max tokens and temperature** still come from
  `GROQ_TIMEOUT_SECONDS`, `GROQ_MAX_TOKENS` and `GROQ_TEMPERATURE`. The names
  are historical — they apply to whichever provider is active.
- **JSON mode** is requested via `response_format`. Providers that ignore it
  are handled: the response is scanned for a JSON object, and if none is found
  the caller falls back.

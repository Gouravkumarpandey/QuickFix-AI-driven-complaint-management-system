# QuickFix AI Service

Simple AI microservice providing text classification, sentiment analysis, and embeddings.

## Setup

1. Create and activate virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env to add HF_API_KEY if using Hugging Face Inference API
```

4. Run development server:
```bash
uvicorn app.main:app --reload --port 8001
```

## API Endpoints

### Classification
```bash
curl -X POST http://localhost:8001/classify \
  -H "Content-Type: application/json" \
  -d '{"text":"I cannot login","labels":["login","billing","bug"]}'
```

### Sentiment Analysis
```bash
curl -X POST http://localhost:8001/sentiment \
  -H "Content-Type: application/json" \
  -d '{"text":"I am very angry"}'
```

### Text Embeddings
```bash
curl -X POST http://localhost:8001/embed \
  -H "Content-Type: application/json" \
  -d '{"text":"My order is late"}'
```

## Docker

Build and run with Docker Compose:
```bash
docker-compose up --build
```

## Models Used

- **Classification**: facebook/bart-large-mnli (zero-shot)
- **Sentiment**: distilbert/distilbert-base-uncased-finetuned-sst-2-english
- **Embeddings**: sentence-transformers/all-MiniLM-L6-v2
- **Summarization**: facebook/bart-large-cnn (abstractive)
- **Reply Generation**: OpenAI GPT-4o-mini (or local alternatives)

All models except reply generation are CPU-friendly and run locally without requiring GPU.

---

## Summarization and Reply Generation

### Summarization Endpoint

Generate concise summaries of long complaints or conversations.

**Endpoint:** `POST /summarize`

**Request Body:**
```json
{
  "text": "Your long complaint text here...",
  "max_length": 120,
  "min_length": 30
}
```

**Response:**
```json
{
  "summary": "Concise summary of the complaint...",
  "model": "facebook/bart-large-cnn",
  "input_length": 856,
  "summary_length": 98
}
```

**Example cURL:**
```bash
curl -X POST http://localhost:8001/summarize \
  -H "Content-Type: application/json" \
  -d '{
    "text": "I have been a loyal customer for 5 years and recently faced a terrible experience. My order #12345 was delayed by 2 weeks without any notification. When I called customer service, I was put on hold for 45 minutes and then disconnected. I tried again the next day and was told my order was lost. This is completely unacceptable and I demand a full refund plus compensation for my time wasted.",
    "max_length": 80,
    "min_length": 30
  }'
```

**Use Cases:**
- Summarize lengthy complaint descriptions
- Generate executive summaries for management
- Create brief ticket overviews for dashboards
- Condense multi-message conversations

---

### Reply Generation Endpoint

Generate draft replies for support tickets using RAG (Retrieval-Augmented Generation) approach.

**Endpoint:** `POST /reply`

**Request Body:**
```json
{
  "text": "Customer ticket text...",
  "kb_context": [
    "Optional KB article snippet 1",
    "Optional KB article snippet 2"
  ],
  "tone": "polite"
}
```

**Parameters:**
- `text` (required): The support ticket or complaint text
- `kb_context` (optional): Array of relevant knowledge base snippets to ground the response
- `tone` (optional): Response tone - `polite`, `friendly`, `professional`, or `empathetic` (default: `polite`)

**Response:**
```json
{
  "draft_reply": "Thank you for contacting us. I sincerely apologize for...",
  "confidence": 0.87,
  "model": "openai/gpt-4o-mini",
  "needs_human_review": false,
  "tone_used": "polite",
  "source": "OpenAI API"
}
```

**Response Fields:**
- `draft_reply`: Generated response text
- `confidence`: Quality score from 0-1
- `model`: Model/API used for generation
- `needs_human_review`: `true` if confidence < 0.8 (requires manual review)
- `tone_used`: Tone that was applied
- `source`: Description of generation method

**Example cURL:**
```bash
curl -X POST http://localhost:8001/reply \
  -H "Content-Type: application/json" \
  -d '{
    "text": "I am extremely frustrated with your service. My internet has been down for 3 days and nobody has helped me!",
    "kb_context": [
      "For internet outages, check router lights. Red light means service issue.",
      "Standard resolution time for outages is 24-48 hours.",
      "Customers can get bill credits for extended outages."
    ],
    "tone": "empathetic"
  }'
```

---

### Configuration for Reply Generation

The reply generation endpoint supports multiple backends:

#### 1. OpenAI API (Recommended for Production)

Set environment variable:
```bash
OPENAI_API_KEY=sk-your-api-key-here
```

**Advantages:**
- High-quality responses
- No local GPU/RAM requirements
- Fast and reliable
- Cost-effective with gpt-4o-mini

**Cost:** ~$0.15 per 1M input tokens, $0.60 per 1M output tokens

#### 2. Hugging Face Inference API (Alternative)

Set environment variable:
```bash
HF_API_KEY=hf_your-api-key-here
```

**Advantages:**
- Access to open-source models
- Lower cost than OpenAI
- No local resources needed

#### 3. Local Models (For On-Premise Deployments)

If no API keys are set, falls back to local model (flan-t5-base).

**Warning:** Local LLM generation requires:
- Significant RAM (8GB+ for small models, 16GB+ for larger)
- GPU recommended for models > 1B parameters
- Lower quality responses compared to API options

**Recommendation:** Use OpenAI or HF Inference API for production deployments.

---

### Safety and Human-in-the-Loop

**⚠️ IMPORTANT:** Do NOT auto-send AI-generated replies to customers!

**Best Practices:**
1. **Always review replies** with `needs_human_review: true`
2. **Set approval workflows** for all AI-generated content
3. **Monitor confidence scores** - establish threshold (e.g., 0.8) for auto-acceptance
4. **Track model performance** - collect feedback on reply quality
5. **Implement rate limiting** to prevent abuse

**Confidence Scoring:**
- **0.9+**: High confidence, still requires review
- **0.8-0.9**: Medium confidence, review recommended
- **< 0.8**: Low confidence, human review required (automatic flag)

**Current confidence calculation uses heuristics:**
- Base score: 0.70
- +0.15 if KB context provided (RAG improves accuracy)
- +0.10 if reply is substantive (50-500 chars)
- +0.05 if ticket is clear (100+ chars)
- Capped at 0.95 (never 100% confident)

**Future Improvements:**
- Train learned confidence scorer on labeled data
- Implement A/B testing for reply quality
- Add feedback loop for continuous improvement
- Use perplexity or BLEU scores for quality metrics

---

## Environment Variables

Update your `.env` file:

```bash
# Service Configuration
PORT=8001

# Optional: Hugging Face API key (for Inference API)
HF_API_KEY=

# Optional: OpenAI API key (for reply generation)
OPENAI_API_KEY=

# Optional: Reply generation mode
# Options: "openai", "local"
# Default: "openai" if OPENAI_API_KEY is set, otherwise "local"
REPLY_MODE=openai
```

---

## API Endpoints Summary

| Endpoint | Method | Purpose | CPU-Friendly |
|----------|--------|---------|--------------|
| `/` | GET | Health check | ✅ |
| `/classify` | POST | Text classification | ✅ |
| `/sentiment` | POST | Sentiment analysis | ✅ |
| `/embed` | POST | Text embeddings | ✅ |
| `/summarize` | POST | Text summarization | ✅ |
| `/reply` | POST | Draft reply generation | ⚠️ API recommended |

---

## Docker

Build and run with Docker Compose:
```bash
# Build the image
docker-compose up --build

# Rebuild after adding new endpoints
docker-compose build ai-service
docker-compose up ai-service
```

Update your `docker-compose.yml` to include the new environment variables:

```yaml
services:
  ai-service:
    build: .
    ports:
      - "8001:8001"
    environment:
      - PORT=8001
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - HF_API_KEY=${HF_API_KEY}
      - REPLY_MODE=openai
    env_file:
      - .env
```

---

## Testing All Endpoints

```bash
# Health Check
curl http://localhost:8001/

# Classification
curl -X POST http://localhost:8001/classify \
  -H "Content-Type: application/json" \
  -d '{"text":"Cannot login","labels":["login","billing","bug"]}'

# Sentiment
curl -X POST http://localhost:8001/sentiment \
  -H "Content-Type: application/json" \
  -d '{"text":"I am very frustrated"}'

# Embeddings
curl -X POST http://localhost:8001/embed \
  -H "Content-Type: application/json" \
  -d '{"text":"Customer support issue"}'

# Summarization
curl -X POST http://localhost:8001/summarize \
  -H "Content-Type: application/json" \
  -d '{"text":"Long complaint text here... (at least 50 characters)","max_length":100}'

# Reply Generation
curl -X POST http://localhost:8001/reply \
  -H "Content-Type: application/json" \
  -d '{"text":"I need help with my account","kb_context":["Account recovery takes 24 hours"],"tone":"friendly"}'
```

---

## Troubleshooting

### Summarization Issues

**Problem:** "Input text too short for summarization"
- **Solution:** Ensure input is at least 50 characters

**Problem:** Slow summarization (> 5 seconds)
- **Solution:** Input text may be too long, will be automatically truncated to ~4000 characters

### Reply Generation Issues

**Problem:** "Reply generation failed: No API key"
- **Solution:** Set OPENAI_API_KEY or HF_API_KEY in `.env`

**Problem:** Low confidence scores (< 0.5)
- **Solution:** Provide kb_context to improve accuracy (RAG approach)

**Problem:** Generic template responses
- **Solution:** This occurs when no API keys are set and local model fails. Use OpenAI or HF API for production.

**Problem:** OpenAI API errors
- **Solution:** Check API key validity, account credits, and rate limits

---

## Performance Considerations

### Model Loading Times (First Run)
- Summarization model (BART-CNN): ~2 minutes to download (1.6GB)
- Other models: Already cached from base setup

### Inference Times (CPU)
- Classification: 200-400ms
- Sentiment: 80-150ms  
- Embeddings: 40-80ms
- Summarization: 500-1500ms (depends on input length)
- Reply (OpenAI API): 1-3 seconds
- Reply (Local): 2-10 seconds (varies by model)

## Validation and startup

Both `python main.py` and `uvicorn app.main:app --port 8001` start the same FastAPI app. `/` and `/health` report service availability without importing heavyweight inference models. Model modules load on their first inference request; cache/download the documented Hugging Face weights and provide enough memory before live use. Model configuration/loading failures return an explicit 503, not a fabricated answer. Health alone does not certify model readiness or answer accuracy.

Run lightweight API contract tests without model downloads:

```bash
python -m pip install -r requirements-test.txt
python -m unittest -v test_service
```

These tests exercise startup, all five endpoint contracts, input limits and failure behavior using model-adapter fixtures. Actual inference quality/latency and external provider delivery require separate live acceptance tests with the intended models/credentials.

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, constr
from typing import List, Optional
import importlib
import logging

logger = logging.getLogger(__name__)

def get_model(name):
    # Health and validation must work without downloading all model weights.
    return importlib.import_module("app.models." + name)

router = APIRouter()

class ClassifyRequest(BaseModel):
    text: constr(strip_whitespace=True, min_length=1, max_length=10000)
    labels: Optional[List[constr(strip_whitespace=True, min_length=1, max_length=100)]] = Field(default=None, min_length=1, max_length=32)

class SentimentRequest(BaseModel):
    text: constr(strip_whitespace=True, min_length=1, max_length=10000)

class EmbedRequest(BaseModel):
    text: constr(strip_whitespace=True, min_length=1, max_length=10000)

class SummarizeRequest(BaseModel):
    text: constr(strip_whitespace=True, min_length=50, max_length=10000)
    max_length: Optional[int] = Field(default=120, ge=30, le=500)
    min_length: Optional[int] = Field(default=30, ge=10, le=200)

class ReplyRequest(BaseModel):
    text: constr(strip_whitespace=True, min_length=10, max_length=10000)
    kb_context: Optional[List[constr(max_length=4000)]] = Field(default=None, max_length=10)
    tone: Optional[str] = Field(default="polite", pattern="^(polite|friendly|professional|empathetic)$")

@router.post("/classify")
def classify_text(request: ClassifyRequest):
    try:
        result = get_model("classifier").classify_text(request.text, request.labels)
        return result
    except Exception as e:
        logger.exception("AI inference failed")
        raise HTTPException(status_code=503, detail="AI model unavailable; check service configuration") from e

@router.post("/sentiment")
def analyze_sentiment(request: SentimentRequest):
    try:
        result = get_model("sentiment").analyze_sentiment(request.text)
        return result
    except Exception as e:
        logger.exception("AI inference failed")
        raise HTTPException(status_code=503, detail="AI model unavailable; check service configuration") from e

@router.post("/embed")
def get_embedding(request: EmbedRequest):
    try:
        embedding = get_model("embedder").get_embedding(request.text)
        return {
            "embedding": embedding,
            "dimensions": len(embedding)
        }
    except Exception as e:
        logger.exception("AI inference failed")
        raise HTTPException(status_code=503, detail="AI model unavailable; check service configuration") from e

@router.post("/summarize")
def summarize_text(request: SummarizeRequest):
    """
    Generate an abstractive summary of the input text.
    
    Use cases:
    - Summarize long complaint descriptions
    - Create executive summaries of ticket conversations
    - Generate brief overviews for dashboards
    
    Note: Requires at least 50 characters of input text.
    """
    try:
        if request.min_length > request.max_length:
            raise ValueError("min_length cannot exceed max_length")
        result = get_model("summarizer").summarize_text(
            text=request.text,
            max_length=request.max_length,
            min_length=request.min_length
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Summarization failed")
        raise HTTPException(status_code=503, detail="Summarization unavailable; check service configuration") from e

@router.post("/reply")
def generate_reply(request: ReplyRequest):
    """
    Generate a draft reply for a support ticket using RAG approach.
    
    Features:
    - Supports multiple tones (polite, friendly, professional, empathetic)
    - Uses KB context for more accurate responses (RAG)
    - Returns confidence score and human review flag
    - Tracks which model/API was used
    
    IMPORTANT: Always review generated replies before sending to customers.
    Set up approval workflows for replies with needs_human_review=True.
    
    Configuration:
    - Set OPENAI_API_KEY env var to use OpenAI (recommended)
    - Set HF_API_KEY to use Hugging Face Inference API
    - Falls back to local model if no API keys set
    """
    try:
        result = get_model("reply_gen").generate_reply(
            ticket_text=request.text,
            kb_context=request.kb_context,
            tone=request.tone
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Reply generation failed")
        raise HTTPException(status_code=503, detail="Reply generation unavailable; check service configuration") from e

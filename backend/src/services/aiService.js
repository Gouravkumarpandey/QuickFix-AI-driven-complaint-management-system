import anthropicService from './anthropicService.js';
import axios from 'axios';

const USE_ANTHROPIC = process.env.ANTHROPIC_API_KEY ? true : false;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

/**
 * AI service client for QuickFix
 * Replaces previous DeepSeek implementation with Anthropic Claude (via OpenRouter)
 */
const aiService = {

  /**
   * Classify text into categories
   */
  async classify(text, labels = null) {
    if (USE_ANTHROPIC) {
      try {
        const categories = labels || ['Account', 'Billing', 'Technical', 'Delivery', 'General'];
        const prompt = `Classify this text into one category: [${categories.join(', ')}].
Text: "${text}"
Return valid JSON: {"category": "...", "confidence": 0.XX}`;

        const response = await anthropicService.chat(prompt, [], { system: 'You are a classifier. Output JSON only.' });

        if (response.success) {
          const jsonMatch = response.response.match(/\{[\s\S]*\}/);
          const result = JSON.parse(jsonMatch ? jsonMatch[0] : response.response);
          return {
            top_label: result.category || 'General',
            confidence: result.confidence || 0.85,
            model: response.model
          };
        }
      } catch (error) {
        console.warn('Anthropic classification failed, using fallback:', error.message);
      }
    }

    // Fallback: keyword-based
    return this._keywordClassify(text);
  },

  /**
   * Classify a complaint and return category, priority, sentiment
   */
  async classifyComplaint(text) {
    if (USE_ANTHROPIC) {
      try {
        const result = await anthropicService.analyzeComplaint(
          text.substring(0, 50) + '...', // Title approximation
          text
        );

        if (result.success) {
          return {
            category: result.category,
            priority: result.priority,
            sentiment: result.sentiment,
            keywords: [], // Claude analysis doesn't return keywords in current impl, can add if needed
            confidence: 0.9,
            model: result.model
          };
        }
      } catch (error) {
        console.warn('Anthropic complaint classification failed:', error.message);
      }
    }

    // Fallback
    return this._keywordComplaintClassify(text);
  },

  /**
   * Analyze text sentiment
   */
  async sentiment(text) {
    // Re-route to anthropic analyze as it covers sentiment
    if (USE_ANTHROPIC) {
      const result = await anthropicService.analyzeComplaint('Sentiment Check', text);
      if (result.success) {
        return {
          label: result.sentiment.toUpperCase(),
          score: 0.9,
          model: result.model
        };
      }
    }

    // Fallback to basic API if configured, or simple check
    return { label: 'NEUTRAL', score: 0.5, model: 'fallback' };
  },

  /**
   * Summarize long text
   * Uses Anthropic chat
   */
  async summarize(text, max_length = 120) {
    if (USE_ANTHROPIC) {
      try {
        const prompt = `Summarize this text in under ${max_length} characters:
"${text}"`;
        const response = await anthropicService.chat(prompt);
        if (response.success) {
          return {
            summary: response.response,
            model: response.model
          };
        }
      } catch (e) { console.warn('Summarize failed', e); }
    }
    return { summary: text.substring(0, max_length) + '...', model: 'fallback' };
  },

  /**
   * Generate draft reply
   */
  async generateReply(text, kb_context = [], tone = 'polite') {
    if (USE_ANTHROPIC) {
      try {
        const toneDesc = {
          polite: 'polite and professional',
          friendly: 'friendly and warm',
          empathetic: 'empathetic and understanding'
        }[tone] || 'professional';

        const contextText = kb_context.length ? `\nContext:\n${kb_context.join('\n')}` : '';
        const prompt = `Write a ${toneDesc} reply to this complaint (under 150 words):
"${text}"${contextText}`;

        const response = await anthropicService.chat(prompt);

        if (response.success) {
          return {
            draft_reply: response.response,
            confidence: 0.9,
            model: response.model,
            needs_human_review: false
          };
        }
      } catch (e) { console.warn('Reply generation failed', e); }
    }

    return {
      draft_reply: 'Thank you for your message. We will get back to you shortly.',
      confidence: 0.5,
      model: 'fallback',
      needs_human_review: true
    };
  },

  // --- Internal Helpers (Keyworld Fallbacks) ---

  _keywordClassify(text) {
    const textLower = text.toLowerCase();
    let category = 'General';
    if (textLower.includes('login') || textLower.includes('password')) category = 'Account';
    else if (textLower.includes('bill') || textLower.includes('payment')) category = 'Billing';
    else if (textLower.includes('slow') || textLower.includes('error')) category = 'Technical';
    return { top_label: category, confidence: 0.7, model: 'keyword' };
  },

  _keywordComplaintClassify(text) {
    const base = this._keywordClassify(text);
    return {
      category: ({ Account: 'Account Issues', Billing: 'Billing', Technical: 'Technical Support', General: 'General Inquiry' })[base.top_label] || 'General Inquiry',
      priority: 'Medium',
      sentiment: 'Neutral',
      keywords: [],
      confidence: 0.6,
      model: 'keyword'
    };
  }
};

export default aiService;

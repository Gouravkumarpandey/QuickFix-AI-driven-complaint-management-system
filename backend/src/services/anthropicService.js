import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

class AnthropicService {
    constructor() {
        this.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

        // Primary model: Claude Sonnet 4.6 via OpenRouter
        this.model = 'anthropic/claude-sonnet-4.6';

        // Free fallback model — Gemini Flash via OpenRouter (GEMINI_API_KEY)
        this.freeModel = 'google/gemini-flash-1.5';

        // Build a list of all available API keys to try in order
        // Both are OpenRouter keys (sk-or-v1-...) from potentially different accounts
        this.apiKeys = [
            ANTHROPIC_API_KEY,
            GEMINI_API_KEY
        ].filter(Boolean); // remove undefined/null entries

        // Primary key for convenience
        this.apiKey = this.apiKeys[0] || null;

        if (this.apiKeys.length === 0) {
            console.warn('⚠️ No API keys set (ANTHROPIC_API_KEY / GEMINI_API_KEY). AI chat will not work.');
        } else {
            console.log(`✅ Anthropic Service initialized with ${this.apiKeys.length} OpenRouter key(s)`);
        }
    }

    /**
     * Internal method to call OpenRouter with a given model
     */
    async _callOpenRouter(model, messages, temperature = 0.7, maxTokens = 1000) {
        if (this.apiKeys.length === 0) {
            throw Object.assign(new Error('No API keys configured'), { response: { status: 401 } });
        }

        let lastError;
        // Try each available key in sequence until one works
        for (const key of this.apiKeys) {
            try {
                const response = await axios.post(
                    this.apiUrl,
                    { model, messages, temperature, max_tokens: maxTokens },
                    {
                        headers: {
                            'Authorization': `Bearer ${key}`,
                            'HTTP-Referer': 'http://localhost:5001',
                            'X-Title': 'QuickFix Complaint System',
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    }
                );
                return response.data.choices[0].message.content;
            } catch (err) {
                const status = err.response?.status;
                const errMsg = err.response?.data?.error?.message || err.message;
                console.warn(`⚠️ OpenRouter key ...${key.slice(-8)} failed for model ${model} (HTTP ${status}): ${errMsg}`);
                lastError = err;
                // Only continue to next key on auth errors; propagate other errors immediately
                if (status !== 401 && status !== 403) throw err;
            }
        }
        // All keys exhausted
        throw lastError;
    }

    /**
     * Generic chat method compatible with previous services
     */
    async chat(message, history = [], context = {}) {
        if (!this.apiKey) {
            console.error('❌ No ANTHROPIC_API_KEY set in .env — AI chat disabled');
            return this._getFallbackResponse('no_key');
        }

        const systemPrompt = this._getSystemPrompt(context);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            })),
            { role: 'user', content: message }
        ];

        // Try primary model (Claude) first
        try {
            const aiResponse = await this._callOpenRouter(this.model, messages, 0.7, 1000);
            console.log('✅ AI response from Claude 3.5 Sonnet');
            return {
                success: true,
                response: aiResponse,
                model: this.model,
                searchUsed: false
            };
        } catch (primaryError) {
            const status = primaryError.response?.status;
            const errData = primaryError.response?.data;
            console.warn(`⚠️ Claude failed (HTTP ${status}):`, errData || primaryError.message);

            // If it's a 401 (bad key) or 402 (no credits), try free fallback model
            if (status === 401 || status === 402 || status === 429) {
                console.log('🔄 Trying free fallback model:', this.freeModel);
                try {
                    const freeResponse = await this._callOpenRouter(this.freeModel, messages, 0.7, 1000);
                    console.log('✅ AI response from free fallback model');
                    return {
                        success: true,
                        response: freeResponse,
                        model: this.freeModel,
                        searchUsed: false
                    };
                } catch (freeError) {
                    const freeStatus = freeError.response?.status;
                    console.error('❌ Free fallback model also failed (HTTP', freeStatus, '):', freeError.response?.data || freeError.message);
                    if (freeStatus === 401) {
                        return this._getFallbackResponse('invalid_key');
                    }
                    return this._getFallbackResponse('api_down');
                }
            }

            console.error('❌ Anthropic Chat Error (non-auth):', primaryError.response?.data || primaryError.message);
            return this._getFallbackResponse('api_down');
        }
    }

    /**
     * Complaint Classification & Analysis
     * Replaces DeepSeek functionality
     */
    async analyzeComplaint(title, description) {
        if (!this.apiKey) return this._getFallbackAnalysis();

        try {
            const prompt = `Analyze this complaint and provide structured data:
Title: ${title}
Description: ${description}

Return JSON with:
1. "category" (Technical Support, Billing, Product Quality, Customer Service, Delivery, General Inquiry, Refund Request, Account Issues)
2. "priority" (Low, Medium, High, Critical)
3. "sentiment" (Positive, Neutral, Negative)
4. "summary" (Brief 1-sentence summary)
`;

            const response = await axios.post(
                this.apiUrl,
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: 'You are an expert customer support analyst. Output valid JSON only.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'HTTP-Referer': 'http://localhost:5001',
                        'X-Title': 'QuickFix Complaint System',
                    }
                }
            );

            const content = response.data.choices[0].message.content;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const data = JSON.parse(jsonMatch ? jsonMatch[0] : content);

            return {
                success: true,
                category: data.category || 'General Inquiry',
                priority: data.priority || 'Medium',
                sentiment: data.sentiment || 'Neutral',
                summary: data.summary,
                model: this.model
            };

        } catch (error) {
            console.error('Analysis Error:', error);
            return this._getFallbackAnalysis();
        }
    }

    /**
     * Intelligent Ticket Assignment
     * Replaces DeepSeek functionality
     */
    async assignTicketToAgent(complaint, agents) {
        if (!this.apiKey || !agents.length) return { success: false, message: 'No API key or agents' };

        try {
            // Prepare agent summaries
            const agentList = agents.map(a =>
                `- ID: ${a.id || a._id}, Name: ${a.name}, Role: ${a.expertise || 'General'}, Load: ${a.activeTickets || 0}`
            ).join('\n');

            const prompt = `Assign this ticket to the best agent based on workload and expertise:
Ticket: [${complaint.category}] ${complaint.title} - ${complaint.description}
Priority: ${complaint.priority}

Available Agents:
${agentList}

Return JSON:
{
  "recommendedAgentId": "ID",
  "reasoning": "Brief reason",
  "confidence": 0.9
}`;

            const response = await axios.post(
                this.apiUrl,
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: 'You are a ticket assignment AI. Select the optimal agent based on load balancing and skill match. Output valid JSON only.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.2
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'HTTP-Referer': 'http://localhost:5001',
                        'X-Title': 'QuickFix Complaint System',
                    }
                }
            );

            const content = response.data.choices[0].message.content;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const data = JSON.parse(jsonMatch ? jsonMatch[0] : content);

            // Find agent object
            const selectedAgent = agents.find(a => (a.id || a._id).toString() === data.recommendedAgentId);

            if (!selectedAgent) throw new Error('AI recommended invalid agent');

            return {
                success: true,
                agent: selectedAgent,
                reasoning: data.reasoning,
                confidence: data.confidence,
                model: this.model,
                assignmentMethod: 'ai-claude'
            };

        } catch (error) {
            console.error('Assignment Error:', error);
            return { success: false, message: 'AI assignment failed' };
        }
    }

    /**
     * Validate complaint authenticity
     */
    async validateComplaint(title, description) {
        if (!this.apiKey) return { isValid: true, reason: 'Skipped validation (No API Key)', confidence: 0 };

        try {
            const prompt = `Check if this complaint is valid or spam/gibberish:
Title: "${title}"
Description: "${description}"

Return JSON:
{
  "isValid": true/false,
  "reason": "Short explanation",
  "confidence": 0.9
}`;

            const response = await axios.post(
                this.apiUrl,
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: 'You are a content moderator. Detect spam, gibberish, or abusive content. Output valid JSON only.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'HTTP-Referer': 'http://localhost:5001',
                        'X-Title': 'QuickFix Complaint System',
                    }
                }
            );

            const content = response.data.choices[0].message.content;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const data = JSON.parse(jsonMatch ? jsonMatch[0] : content);

            return {
                isValid: data.isValid,
                reason: data.reason,
                confidence: data.confidence,
                model: this.model
            };
        } catch (error) {
            console.error('Validation Error:', error);
            return { isValid: true, reason: 'Validation failed (Fallback)', confidence: 0 };
        }
    }

    _getSystemPrompt(context) {
        // Use custom system instruction if provided (e.g. QUICKFIX_KB for public chatbot)
        if (context.systemInstruction) {
            return context.systemInstruction;
        }

        // Build default user-context-aware prompt for the dashboard AI assistant
        let prompt = `You are a helpful AI assistant for QuickFix, a complaint management system.

User: ${context.userName || 'Customer'} (${context.userRole || 'User'})
Email: ${context.userEmail || 'N/A'}

Your goal is to assist the user with their complaints, answer questions about QuickFix, and help with general queries. Be concise and professional.`;

        if (context.complaints && context.complaints.length > 0) {
            prompt += `\n\nUser's Recent Complaints:\n`;
            context.complaints.forEach((c, i) => {
                prompt += `${i + 1}. [${c.complaintId || c.ticketId}] ${c.title} (${c.status}) - ${c.category}\n   Description: ${c.description?.substring(0, 100)}...\n`;
            });
            prompt += `\nIf the user asks about a specific complaint, use this information.`;
        } else {
            prompt += `\n\nThe user has no recent active complaints in the system.`;
        }

        return prompt;
    }

    _getFallbackResponse(reason = 'api_down') {
        const messages = {
            no_key: "⚙️ The AI assistant is not configured yet. Please contact your administrator to set up the API key.",
            invalid_key: "🔑 The AI API key appears to be invalid or expired. Please contact your administrator to update it in the backend .env file.",
            api_down: "⚠️ I'm having trouble reaching the AI service right now. Please wait a moment and try again."
        };
        const response = messages[reason] || messages.api_down;
        console.error(`🔴 AI Fallback triggered (reason: ${reason}): returning static message to user`);
        return { success: true, response, fallback: true, fallbackReason: reason };
    }

    _getFallbackAnalysis() {
        return { success: true, category: 'General', priority: 'Medium', sentiment: 'Neutral', model: 'fallback' };
    }
}

export default new AnthropicService();

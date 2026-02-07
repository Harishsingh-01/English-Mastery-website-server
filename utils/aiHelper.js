// Model Configuration
const GEMINI_MODEL = 'google/gemini-2.5-flash-lite-preview-09-2025';

/**
 * Helper to call OpenRouter API with comprehensive error handling and retry logic
 * @param {string} prompt - The text prompt to send
 * @param {boolean} jsonMode - Whether to request JSON response
 * @param {number} retryCount - Current retry attempt (internal use)
 * @returns {Promise<string>} - The raw text response from AI
 */
async function generateContent(prompt, jsonMode = false, retryCount = 0) {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 1000; // Base delay: 1 second

    if (!apiKey) {
        const err = new Error('AI service configuration error. Please contact support.');
        err.status = 500;
        err.userMessage = 'AI service is not configured. Please contact support.';
        throw err;
    }

    try {
        // Dynamic import to handle both CJS and ESM package types robustly
        const { OpenRouter } = await import("@openrouter/sdk");

        const openrouter = new OpenRouter({
            apiKey: apiKey
        });

        const stream = await openrouter.chat.send({
            model: GEMINI_MODEL,
            messages: [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ],
            max_output_tokens: 4000,
            max_tokens: 2048,
            response_format: jsonMode ? { "type": "json_object" } : undefined,
            stream: true
        });

        let fullText = "";

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                fullText += content;
            }
        }

        // Validate the result
        if (!fullText || fullText.trim().length === 0) {
            const err = new Error('AI service returned an empty response. Please try again.');
            err.status = 502;
            err.userMessage = 'AI service returned an invalid response. Please try again.';
            throw err;
        }

        return fullText;

    } catch (error) {
        // Log the error with context
        console.error('[AI Service Error]', {
            message: error.message,
            status: error.status,
            retryCount: retryCount,
            timestamp: new Date().toISOString()
        });

        // --- SPECIFIC ERROR HANDLING ---

        // Specific error handling for 402 (Payment/Credits Error)
        if (error.status === 402 || error.message?.includes('402') || error.message?.includes('credits')) {
            const err = new Error('Insufficient AI credits or configuration issue');
            err.status = 402;
            // More helpful message that hints at potential server restart issue
            err.userMessage = 'AI service temporarily unavailable due to credit or configuration issue. If this persists, please contact support or restart the service.';
            throw err;
        }

        // 2. Rate Limit Error (429)
        if (error.status === 429 || error.message?.includes('429') || error.message?.includes('rate limit')) {
            // Retry with exponential backoff
            if (retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
                console.log(`[AI Service] Rate limited. Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return generateContent(prompt, jsonMode, retryCount + 1);
            }

            const err = new Error('AI service rate limit exceeded');
            err.status = 429;
            err.userMessage = 'AI service is busy. Please try again in a moment.';
            throw err;
        }

        // 3. Authentication Error (401/403)
        if (error.status === 401 || error.status === 403 ||
            error.message?.includes('401') || error.message?.includes('403') ||
            error.message?.includes('unauthorized') || error.message?.includes('forbidden')) {
            const err = new Error('AI service authentication failed');
            err.status = 500;
            err.userMessage = 'AI service authentication failed. Please contact support.';
            throw err;
        }

        // 4. Network/Timeout Errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' ||
            error.code === 'ENOTFOUND' || error.message?.includes('network') ||
            error.message?.includes('timeout') || error.message?.includes('ECONNRESET')) {

            // Retry for network errors
            if (retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
                console.log(`[AI Service] Network error. Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return generateContent(prompt, jsonMode, retryCount + 1);
            }

            const err = new Error('Unable to connect to AI service');
            err.status = 503;
            err.userMessage = 'Unable to connect to AI service. Please check your internet connection and try again.';
            throw err;
        }

        // 5. Already formatted error (from validation above)
        if (error.status && error.userMessage) {
            throw error;
        }

        // 6. Generic/Unknown Error
        const err = new Error('AI service error: ' + error.message);
        err.status = 500;
        err.userMessage = 'An unexpected error occurred with the AI service. Please try again.';
        throw err;
    }
}

module.exports = { generateContent };

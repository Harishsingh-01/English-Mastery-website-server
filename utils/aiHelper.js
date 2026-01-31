// Model Configuration
const GEMINI_MODEL = 'google/gemini-2.5-flash-lite-preview-09-2025';

/**
 * Helper to call OpenRouter API with centralized error handling
 * @param {string} prompt - The text prompt to send
 * @param {boolean} jsonMode - Whether to request JSON response
 * @returns {Promise<string>} - The raw text response from AI
 */
async function generateContent(prompt, jsonMode = false) {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error('OpenRouter API Key missing (OPENROUTER_API_KEY)');
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
            stream: true
        });

        let fullText = "";

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                fullText += content;
            }
        }

        // Basic validation on the result
        if (!fullText) {
            const err = new Error('AI returned an empty response.');
            err.status = 502;
            throw err;
        }

        return fullText;

    } catch (error) {
        // Re-throw if it already has a status, otherwise wrap
        if (error.status) throw error;
        console.error('OpenRouter Wrapper Error:', error);

        const errInfo = error.message || 'Unknown error';
        if (errInfo.includes('429')) {
            const quotaErr = new Error('Daily quota exceeded (OpenRouter). Please try again later.');
            quotaErr.status = 429;
            throw quotaErr;
        }

        throw new Error(`Failed to connect to AI service: ${errInfo}`);
    }
}

module.exports = { generateContent };

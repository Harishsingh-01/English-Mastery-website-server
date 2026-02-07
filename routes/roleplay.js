const express = require('express');
const router = express.Router();
const { generateContent: generateAIResponse } = require('../utils/aiHelper');
const auth = require('../middleware/auth');

// Scenarios Configuration
const SCENARIOS = {
    cafe: {
        title: "Coffee Shop",
        basePrompt: "You are a friendly barista at 'Star Beans'.",
        goal: "Order a drink and confirm payment.",
        initialMessage: "Hi there! Welcome to Star Beans. What can I get started for you today?"
    },
    doctor: {
        title: "Doctor's Appointment",
        basePrompt: "You are a helpful doctor. The user is a patient.",
        goal: "Describe symptoms and get a diagnosis.",
        initialMessage: "Good morning. I see you have an appointment. What seems to be the trouble today?"
    },
    job_negotiation: {
        title: "Salary Negotiation",
        basePrompt: "You are a tough but fair hiring manager.",
        goal: "Negotiate a higher salary after a job offer.",
        initialMessage: "We're really excited to offer you the position. The starting salary is $60,000. What are your thoughts?"
    },
    airport: {
        title: "Airport Check-in",
        basePrompt: "You are an airline check-in agent.",
        goal: "Check in for a flight and handle luggage.",
        initialMessage: "Next please! Hello, where are you flying to today?"
    }
};

// @route   POST /api/roleplay/start
// @desc    Start a new roleplay scenario
// @access  Private
router.post('/start', auth, async (req, res) => {
    const { scenario } = req.body;

    if (!SCENARIOS[scenario]) {
        return res.status(400).json({ msg: 'Invalid scenario' });
    }

    // Return the initial message and scenario config
    res.json({
        message: SCENARIOS[scenario].initialMessage,
        scenarioConfig: SCENARIOS[scenario]
    });
});

// @route   POST /api/roleplay/chat
// @desc    Continue the conversation
// @access  Private
router.post('/chat', auth, async (req, res) => {
    const { message, history, scenario, difficulty = 'medium', correctionMode = 'off' } = req.body;

    if (!message || !scenario || !SCENARIOS[scenario]) {
        return res.status(400).json({ msg: 'Invalid request' });
    }

    try {
        const config = SCENARIOS[scenario];

        // 1. Difficulty Logic
        let difficultyInstruction = "";
        switch (difficulty) {
            case 'easy': difficultyInstruction = "Speak in short, simple sentences. Speak slowly. Be very helpful/patient."; break;
            case 'medium': difficultyInstruction = "Speak naturally like a native speaker. Normal speed."; break;
            case 'hard': difficultyInstruction = "Speak fast, use idioms/slang suitable for the context. Be less patient or stricter if the role implies it (e.g., busy waiter). Apply real-life pressure."; break;
        }

        // 2. Goal & Correction Instructions
        const systemPrompt = `
        Role: ${config.basePrompt}
        User's Goal: ${config.goal}
        your Task: Roleplay with the user.
        - ${difficultyInstruction}
        - Push the conversation forward towards the goal.
        - If the user fails or gets stuck, guide them.

        OUTPUT FORMAT: Return a JSON object ONLY.
        {
            "response": "Your spoken reply to the user...",
            "suggestion": "A better/more native phrase the user COULD have said instead of their last message (optional, null if perfect)",
            "correction": "Soft grammar correction if needed (optional, null if perfect). Be gentle."
        }

        ${correctionMode === 'off' ? 'ignore correction field (return null).' : 'Provide soft corrections in the "correction" field.'}
        `;

        // Construct Chat History for AI
        // We need to pass history as a "chat" structure or just lines
        let fullPrompt = systemPrompt + "\n\nConversation History:\n";
        if (history && history.length > 0) {
            history.forEach(msg => {
                fullPrompt += `${msg.role === 'user' ? 'User' : 'Roleplayer'}: ${msg.content}\n`;
            });
        }
        fullPrompt += `User: ${message}\nRoleplayer: (JSON)`;

        const textResponse = await generateAIResponse(fullPrompt, 'gemini-2.0-flash-lite-preview-02-05', true); // Force JSON

        if (textResponse) {
            await incrementUsage(req.user.id);

            // Safe Parse
            let result;
            try {
                const match = textResponse.match(/\{[\s\S]*\}/);
                const jsonStr = match ? match[0] : textResponse;
                result = JSON.parse(jsonStr);
            } catch (e) {
                console.error("AI Roleplay Parse Failed", textResponse);
                // Fallback
                result = { response: textResponse, suggestion: null, correction: null };
            }

            res.json(result);
        } else {
            res.status(500).json({ msg: "AI response failed" });
        }

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Import Model
const RoleplaySession = require('../models/RoleplaySession');

// ... (existing code)

// @route   POST /api/roleplay/feedback
// @desc    Analyze the full conversation AND save to DB
// @access  Private
router.post('/feedback', auth, async (req, res) => {
    const { history, scenario } = req.body;

    try {
        const prompt = `
        You are an English communication coach. The user just finished a roleplay scenario: "${scenario}".
        Here is the transcript:
        ${JSON.stringify(history)}

        Please analyze their performance. Return a JSON object with:
        1. "score" (0-10)
        2. "feedback" (General paragraph)
        3. "improvements" (Array of objects: { "original": "...", "improved": "...", "reason": "..." }) focusing on politeness, vocabulary, and grammar.
        `;

        const aiResponse = await generateAIResponse(prompt, 'gemini-2.0-flash-lite-preview-02-05', true); // Json mode

        if (aiResponse) {
            await incrementUsage(req.user.id);

            // Clean up markdown code blocks if present
            let cleanResponse = aiResponse.trim();
            if (cleanResponse.startsWith('```json')) {
                cleanResponse = cleanResponse.replace(/^```json/, '').replace(/```$/, '');
            } else if (cleanResponse.startsWith('```')) {
                cleanResponse = cleanResponse.replace(/^```/, '').replace(/```$/, '');
            }

            try {
                const jsonResponse = JSON.parse(cleanResponse);

                // SAVE TO DB
                const newSession = new RoleplaySession({
                    userId: req.user.id,
                    scenario: scenario,
                    messages: history,
                    feedback: jsonResponse
                });
                await newSession.save();

                res.json(jsonResponse);
            } catch (parseError) {
                console.error("JSON Parse Error:", parseError);
                console.error("Raw Response:", aiResponse);
                res.status(500).json({ msg: "Failed to parse AI analysis" });
            }
        } else {
            res.status(500).json({ msg: "AI feedback failed" });
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

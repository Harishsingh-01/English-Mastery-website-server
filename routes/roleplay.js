const express = require('express');
const router = express.Router();
const { generateContent: generateAIResponse } = require('../utils/aiHelper');
const auth = require('../middleware/auth');
const { checkQuota, incrementUsage } = require('../middleware/quota');

// Scenarios Configuration
const SCENARIOS = {
    cafe: {
        title: "Coffee Shop",
        systemPrompt: "You are a friendly barista at a coffee shop called 'Star Beans'. The user is a customer. Your goal is to take their order. Start by welcoming them. Keep responses short (1-2 sentences) and conversational. Do not correct their grammar yet, just roleplay natural conversation.",
        initialMessage: "Hi there! Welcome to Star Beans. What can I get started for you today?"
    },
    doctor: {
        title: "Doctor's Appointment",
        systemPrompt: "You are a helpful doctor. The user is a patient describing symptoms. Ask clarifying questions about their health. Keep responses professional but warm. Do not correct grammar yet.",
        initialMessage: "Good morning. I see you have an appointment. What seems to be the trouble today?"
    },
    job_negotiation: {
        title: "Salary Negotiation",
        systemPrompt: "You are a tough but fair hiring manager. The user has just received a job offer and is trying to negotiate a higher salary. Be professional, slightly resistant, but open to good arguments.",
        initialMessage: "We're really excited to offer you the position. The starting salary is $60,000. What are your thoughts?"
    },
    airport: {
        title: "Airport Check-in",
        systemPrompt: "You are an airline check-in agent. The user is checking in for a flight. Ask for their passport and if they have bags to check.",
        initialMessage: "Next please! Hello, where are you flying to today?"
    }
};

// @route   POST /api/roleplay/start
// @desc    Start a new roleplay scenario
// @access  Private
router.post('/start', auth, checkQuota, async (req, res) => {
    const { scenario } = req.body;

    if (!SCENARIOS[scenario]) {
        return res.status(400).json({ msg: 'Invalid scenario' });
    }

    // We don't need to call AI for the first message, we can use the static initial message
    // But we count it as usage to prevent abuse if we wanted, though strictly it's static.
    // Let's NOT count quota for starting, only for chatting.

    res.json({
        message: SCENARIOS[scenario].initialMessage,
        scenarioConfig: SCENARIOS[scenario]
    });
});

// @route   POST /api/roleplay/chat
// @desc    Continue the conversation
// @access  Private
router.post('/chat', auth, checkQuota, async (req, res) => {
    const { message, history, scenario } = req.body;

    if (!message || !scenario || !SCENARIOS[scenario]) {
        return res.status(400).json({ msg: 'Invalid request' });
    }

    try {
        const scenarioConfig = SCENARIOS[scenario];

        // Construct prompt with history
        let prompt = `System: ${scenarioConfig.systemPrompt}\n\n`;

        // Add last few turns of history for context (simplified)
        // ideally history should come from client formatted correctly
        if (history && history.length > 0) {
            history.forEach(msg => {
                prompt += `${msg.role === 'user' ? 'Customer' : 'Roleplayer'}: ${msg.content}\n`;
            });
        }

        prompt += `Customer: ${message}\nRoleplayer:`;

        const aiResponse = await generateAIResponse(prompt, 'gemini-2.0-flash-lite-preview-02-05'); // Using fast model

        if (aiResponse) {
            await incrementUsage(req.user.id);
            res.json({ response: aiResponse });
        } else {
            res.status(500).json({ msg: "AI could not generate a response" });
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
router.post('/feedback', auth, checkQuota, async (req, res) => {
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

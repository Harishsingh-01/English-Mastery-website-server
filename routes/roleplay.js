const express = require('express');
const router = express.Router();
const { generateContent: generateAIResponse } = require('../utils/aiHelper');
const auth = require('../middleware/auth');
const { incrementUsage } = require('../middleware/quota');

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
    },
    restaurant: {
        title: "Fine Dining Restaurant",
        basePrompt: "You are a polite waiter at an upscale restaurant.",
        goal: "Order a meal, ask questions about the menu, and handle the bill.",
        initialMessage: "Good evening! Welcome to The Golden Fork. May I start you off with something to drink?"
    },
    hotel: {
        title: "Hotel Check-in",
        basePrompt: "You are a professional hotel receptionist.",
        goal: "Check in, ask about amenities, and resolve any room issues.",
        initialMessage: "Welcome to The Grand Hotel! Do you have a reservation with us?"
    },
    shopping: {
        title: "Clothing Store",
        basePrompt: "You are a helpful sales associate at a fashion boutique.",
        goal: "Find the right clothes, ask about sizes, and complete a purchase.",
        initialMessage: "Hi there! Looking for anything specific today? We just got new arrivals in!"
    },
    customer_service: {
        title: "Product Return",
        basePrompt: "You are a customer service representative handling returns.",
        goal: "Explain the problem and get a refund or exchange.",
        initialMessage: "Hello! I see you'd like to make a return. Can you tell me what the issue is?"
    },
    bank: {
        title: "Bank Visit",
        basePrompt: "You are a bank teller helping customers.",
        goal: "Open an account, deposit money, or resolve a banking issue.",
        initialMessage: "Good afternoon! How can I help you with your banking needs today?"
    },
    pharmacy: {
        title: "Pharmacy",
        basePrompt: "You are a pharmacist helping customers with medications.",
        goal: "Pick up a prescription and ask about medication instructions.",
        initialMessage: "Hi! Are you here to pick up a prescription or do you need help finding something?"
    },
    gym: {
        title: "Gym Membership",
        basePrompt: "You are a fitness center staff member selling memberships.",
        goal: "Ask about membership plans and gym facilities.",
        initialMessage: "Hey! Welcome to FitLife Gym. Are you interested in joining or just looking around?"
    },
    tech_support: {
        title: "Tech Support Call",
        basePrompt: "You are a tech support specialist helping with computer issues.",
        goal: "Explain your tech problem and get help fixing it.",
        initialMessage: "Thank you for calling TechHelp. What seems to be the problem with your device today?"
    },
    real_estate: {
        title: "Apartment Viewing",
        basePrompt: "You are a real estate agent showing apartments.",
        goal: "Ask about the apartment, rent, and amenities.",
        initialMessage: "Hi! Great to meet you. Let me show you this beautiful two-bedroom apartment. What are you looking for?"
    },
    travel_agency: {
        title: "Travel Planning",
        basePrompt: "You are a travel agent helping plan vacations.",
        goal: "Plan a trip, ask about destinations, and book flights/hotels.",
        initialMessage: "Welcome to DreamTrips Travel! Where would you like to go on your next adventure?"
    },
    car_rental: {
        title: "Car Rental",
        basePrompt: "You are a car rental agent.",
        goal: "Rent a car, ask about insurance, and understand rental terms.",
        initialMessage: "Hello! Welcome to QuickDrive Rentals. What type of vehicle are you looking for today?"
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

// @route   GET /api/roleplay/scenarios
// @desc    Get all available scenarios
// @access  Private
router.get('/scenarios', auth, async (req, res) => {
    // Return all scenario keys and titles
    const scenarioList = Object.keys(SCENARIOS).map(key => ({
        id: key,
        title: SCENARIOS[key].title,
        goal: SCENARIOS[key].goal
    }));
    res.json(scenarioList);
});

// @route   GET /api/roleplay/random
// @desc    Get a random predefined scenario
// @access  Private
router.get('/random', auth, async (req, res) => {
    const scenarioKeys = Object.keys(SCENARIOS);
    const randomKey = scenarioKeys[Math.floor(Math.random() * scenarioKeys.length)];

    res.json({
        scenarioId: randomKey,
        message: SCENARIOS[randomKey].initialMessage,
        scenarioConfig: SCENARIOS[randomKey]
    });
});

// @route   POST /api/roleplay/generate-random
// @desc    Generate a completely random AI-powered scenario
// @access  Private
router.post('/generate-random', auth, async (req, res) => {
    try {
        const { difficulty = 'medium' } = req.body;

        const prompt = `Generate a unique, creative roleplay scenario for English conversation practice.
        
        Create a scenario that is:
        - Realistic and practical for everyday English learners
        - Different from common scenarios (avoid: coffee shop, doctor, airport unless you add a unique twist)
        - Culturally appropriate and educational
        - Clear with a specific conversation goal
        
        Difficulty level: ${difficulty}
        
        Return STRICT JSON format:
        {
            "title": "Scenario title (e.g., 'Lost Pet Search', 'Neighbor Noise Complaint')",
            "basePrompt": "Description of the AI's role (e.g., 'You are a sympathetic animal shelter worker')",
            "goal": "User's conversation objective (e.g., 'Report a lost pet and provide details')",
            "initialMessage": "The opening line from the AI character to start the conversation",
            "context": "Brief background context to help the user understand the situation"
        }`;

        const aiResponse = await generateAIResponse(prompt, 'gemini-2.0-flash-lite-preview-02-05', true);
        await incrementUsage(req.user.id);

        // Parse response
        let cleanResponse = aiResponse.trim();
        if (cleanResponse.startsWith('```json')) {
            cleanResponse = cleanResponse.replace(/^```json/, '').replace(/```$/, '');
        } else if (cleanResponse.startsWith('```')) {
            cleanResponse = cleanResponse.replace(/^```/, '').replace(/```$/, '');
        }

        const scenario = JSON.parse(cleanResponse);

        res.json({
            scenarioId: 'ai_generated',
            message: scenario.initialMessage,
            scenarioConfig: scenario
        });

    } catch (err) {
        console.error('Random scenario generation error:', err);
        res.status(500).json({ msg: 'Failed to generate random scenario', error: err.message });
    }
});

// @route   POST /api/roleplay/chat
// @desc    Continue the conversation
// @access  Private
router.post('/chat', auth, async (req, res) => {
    const { message, history, scenario, difficulty = 'medium', correctionMode = 'off' } = req.body;

    if (!message || !scenario || (!SCENARIOS[scenario] && scenario !== 'ai_generated')) {
        return res.status(400).json({ msg: 'Invalid request' });
    }

    try {
        // Support both predefined and AI-generated scenarios
        const config = scenario === 'ai_generated' ? req.body.scenarioConfig : SCENARIOS[scenario];

        if (!config) {
            return res.status(400).json({ msg: 'Scenario configuration missing' });
        }

        // 1. Difficulty Logic with more variation
        let difficultyInstruction = "";
        let personalityVariation = "";

        switch (difficulty) {
            case 'easy':
                difficultyInstruction = "Speak in short, simple sentences (5-8 words). Be very helpful, patient, and encouraging. Use basic vocabulary only.";
                personalityVariation = "Be extra friendly and supportive. Smile through your words.";
                break;
            case 'medium':
                difficultyInstruction = "Speak naturally like a native speaker. Use normal conversational pace and vocabulary.";
                personalityVariation = "Be professional but friendly. Vary between helpful and neutral tones naturally.";
                break;
            case 'hard':
                difficultyInstruction = "Speak fast, use idioms, slang, and colloquial expressions. Be realistic - show impatience if the user takes too long or makes mistakes. Use complex sentences.";
                personalityVariation = "Act like a real person in a hurry. Be less accommodating. Show subtle frustration if appropriate.";
                break;
        }

        // 2. Add conversation progression awareness
        const messageCount = history ? history.length : 0;
        let progressionInstruction = "";

        if (messageCount === 0) {
            progressionInstruction = "This is the beginning. Keep your response welcoming and clear about what you need.";
        } else if (messageCount < 4) {
            progressionInstruction = "Early conversation. Gradually move toward the goal, but don't rush.";
        } else if (messageCount < 8) {
            progressionInstruction = "Mid conversation. Push toward completing the goal. Add minor complications if the user is doing well.";
        } else {
            progressionInstruction = "Wrap up the conversation. Start moving toward closure and completion of the goal.";
        }

        // 3. Dynamic response variation prompts
        const responseVariations = [
            "Vary your sentence structure. Don't always start with the same patterns.",
            "Use different expressions for the same meaning (e.g., 'Sure!', 'Absolutely!', 'No problem!', 'Of course!').",
            "Occasionally use filler words like native speakers: 'Well...', 'Let me see...', 'Hmm...' (but not too much).",
            "React naturally to what the user says - show emotion where appropriate (surprise, concern, happiness).",
        ];
        const randomVariation = responseVariations[Math.floor(Math.random() * responseVariations.length)];

        // 4. Goal & Correction Instructions
        const systemPrompt = `
        Role: ${config.basePrompt}
        User's Goal: ${config.goal}
        ${config.context ? `Context: ${config.context}` : ''}
        
        Your Task: Roleplay with the user naturally and realistically.
        - ${difficultyInstruction}
        - ${personalityVariation}
        - ${progressionInstruction}
        - ${randomVariation}
        - Push the conversation forward towards the goal, but make it feel natural.
        - If the user struggles, guide them subtly.
        - DON'T repeat the same phrases. Use variety in your responses.
        - React to what the user actually says, don't ignore their input.

        OUTPUT FORMAT: Return a JSON object ONLY.
        {
            "response": "Your spoken reply to the user (vary length and structure based on difficulty and context)",
            "suggestion": "A better/more native phrase the user COULD have said instead of their last message (optional, null if perfect)",
            "correction": "Soft grammar correction if needed (optional, null if perfect). Be gentle and encouraging."
        }

        ${correctionMode === 'off' ? 'Set correction field to null (corrections disabled).' : 'Provide soft, encouraging corrections in the "correction" field only for clear errors.'}
        `;

        // Construct Chat History for AI
        let fullPrompt = systemPrompt + "\n\nConversation History:\n";
        if (history && history.length > 0) {
            // Limit history to last 10 messages to save tokens
            const recentHistory = history.slice(-10);
            recentHistory.forEach(msg => {
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

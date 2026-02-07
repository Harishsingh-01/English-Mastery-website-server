const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const DebateSession = require('../models/DebateSession');
const { generateContent } = require('../utils/aiHelper');

// Initialize debate (Generate Topic + Sides)
router.post('/init', auth, async (req, res) => {
    const { topic, difficulty = 'medium' } = req.body;

    try {
        let selectedTopic = topic;
        let sides = ["Agree", "Disagree"]; // Default

        if (!selectedTopic) {
            // GENERATE NEW TOPIC
            let topicPrompt = `Generate a controversial but safe topic for an English debate practice session. Difficulty: ${difficulty}. Return ONLY the topic sentence.`;

            if (difficulty === 'easy') {
                const randomSeed = Math.random();
                topicPrompt = `You are a topic generator for beginner English learners.
                Generate a completely new, random, simple debate topic.
                Random Seed: ${randomSeed} (Use this to ensure variety).
                Constraints:
                - Max 4-7 words.
                - Use only simple vocabulary (A1 Level).
                - NEVER generate topics about "Cats" or "Dogs".
                - VARY the subject.
                Return ONLY the topic sentence.`;
            }
            selectedTopic = await generateContent(topicPrompt);
        }

        // EXTRACT SIDES
        const sidePrompt = `Topic: "${selectedTopic}"
        Identify the two opposing sides of this debate.
        Return JSON ONLY: ["Side A", "Side B"]
        Example for "Cats vs Dogs": ["Cats", "Dogs"]
        Example for "Homework is bad": ["Agree", "Disagree"]`;

        const sideRes = await generateContent(sidePrompt, true);
        try {
            const jsonMatch = sideRes.match(/\[[\s\S]*\]/);
            if (jsonMatch) sides = JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("JSON Parse Error", e);
        }

        res.json({ topic: selectedTopic, sides });

    } catch (err) {
        next(err);
    }
});

// Start a new debate
router.post('/start', auth, async (req, res) => {
    const { topic, difficulty = 'medium', userStance } = req.body; // Added userStance


    try {
        // Topic is now passed from frontend (generated via /init)

        // Generate opening statement
        const openingPrompt = `You are debating about "${topic}". 
        Difficulty Level: ${difficulty}.
        User's Stance: "${userStance}".
        
        Your Goal: You must argue AGAINST the user's stance.
        
        CRITICAL CONSTRAINTS:
        - MAXIMUM LENGTH: 200-400 characters (strictly enforced)
        - Keep it punchy and concise - debate responses, not essays
        - If difficulty is 'easy', use A2 (Elementary) level English
        - Use simple, natural everyday words. Avoid complex academic terms
        - WRITE 2-4 CLEAR, SHORT SENTENCES
        - Example: "I disagree. [Opposite] is better because [1-2 reasons]."
        
        Return ONLY your opening statement (200-400 characters max).`;

        const openingStatement = await generateContent(openingPrompt);

        const session = new DebateSession({
            user: req.user.id,
            topic: topic,
            difficulty,
            turns: [{
                role: 'ai',
                content: openingStatement
            }]
        });

        await session.save();

        res.json({
            sessionId: session._id,
            topic: topic,
            openingStatement
        });

    } catch (err) {
        next(err);
    }
});

// Process a user turn
router.post('/turn', auth, async (req, res) => {
    const { sessionId, message, argumentHistory, strategy } = req.body; // Added strategy

    try {
        const session = await DebateSession.findById(sessionId);
        if (!session) return res.status(404).json({ msg: 'Session not found' });
        if (session.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Unauthorized' });

        // 1. Analyze User Input (Quick Feedback)
        const feedbackPrompt = `Analyze this user argument in a debate about "${session.topic}".
        User Argument: "${message}"

        Return JSON ONLY:
        {
            "coherenceScore": (1-100 integer, how logical?),
            "strengthScore": (1-100 integer, how strong is the point?),
            "fallacies": ["If a logical error is found, explain it in very simple English (A2 level). Example: 'You attacked the person instead of the idea.' instead of 'Ad Hominem'. Return empty array if good."],
            "feedback": "1 sentence quick tip to improve."
        }`;

        const feedbackRes = await generateContent(feedbackPrompt, true);

        let feedbackData = { coherenceScore: 0, strengthScore: 0, fallacies: [], feedback: "Keep going!" };
        try {
            const jsonMatch = feedbackRes.match(/\{[\s\S]*\}/);
            if (jsonMatch) feedbackData = JSON.parse(jsonMatch[0]);
        } catch (e) { console.error("JSON Parse Error", e); }

        // Save User Turn
        session.turns.push({
            role: 'user',
            content: message,
            analysis: feedbackData
        });

        // 2. Generate AI Rebuttal
        const context = session.turns.map(t => `${t.role === 'user' ? 'Opponent' : 'You'}: ${t.content}`).join('\n');

        // Prepare Memory String from DB (Single Source of Truth)
        const memoryContext = "PAST ARGUMENTS (Check for contradictions):\n" +
            session.turns
                .filter(t => t.role === 'user')
                .map((t, i) => `User Turn ${i + 1}: "${t.content}"`)
                .join('\n');

        // STRATEGY ENGINE LOGIC
        let strategyInstructions = "";
        if (strategy) {
            strategyInstructions = `
            STRATEGY MODE: ${strategy.mode.toUpperCase()}
            AGGRESSION LEVEL: ${strategy.aggression * 100}%
            ANALYSIS DEPTH: Level ${strategy.depth}
            
            BEHAVIOR GUIDELINES:
            - If Mode is 'defend': Be polite, focus on finding common ground, correct gently.
            - If Mode is 'attack': Be sharp, relentlessly find flaws, ask trapping questions.
            - If Mode is 'balanced': Mix agreement with constructive counter-points.
            `;
        } else {
            // Fallback if strategy missing
            strategyInstructions = `Maintain a ${session.difficulty} vocabulary level.`;
        }

        // Add vocabulary constraints separately
        let vocabInstructions = "";
        if (session.difficulty === 'easy') {
            vocabInstructions = "- Vocabulary: A2 (Elementary). Simple sentences.";
        } else if (session.difficulty === 'medium') {
            vocabInstructions = "- Vocabulary: B1/B2 (Intermediate). Professional tone.";
        } else {
            vocabInstructions = "- Vocabulary: C1/C2 (Advanced). Sophisticated and precise.";
        }

        const rebuttalPrompt = `You are debating about "${session.topic}".
        
        ${memoryContext}

        Current Dialogue:
        ${context}

        Your Goal: DIRECTLY respond to the opponent's last point.
        
        ${strategyInstructions}
        ${vocabInstructions}
        
        CRITICAL CONSTRAINT:
        - MAXIMUM LENGTH: 200-400 characters (strictly enforced)
        - Keep it concise and punchy - short debate turns, not long paragraphs
        
        INSTRUCTIONS:
        1. MEMORY CHECK: If USER contradicted previous statements, point it out briefly.
        2. ACKNOWLEDGE: One sentence on their point.
        3. COUNTER: Apply strategy mode (${strategy ? strategy.mode : 'standard'}) - 1-2 sentences max.
        
        IMPORTANT: Listen and Respond. No monologues. Be concise!
        Return ONLY your text response (200-400 characters max).`;

        const rebuttal = await generateContent(rebuttalPrompt);

        session.turns.push({
            role: 'ai',
            content: rebuttal
        });

        await session.save();

        res.json({
            reply: rebuttal,
            feedback: feedbackData
        });

    } catch (err) {
        next(err);
    }
});

// End Debate & Get Final Report
router.post('/end', auth, async (req, res) => {
    const { sessionId } = req.body;

    try {
        const session = await DebateSession.findById(sessionId);
        if (!session) return res.status(404).json({ msg: 'Session not found' });

        // Generate Final Report
        const userTurns = session.turns.filter(t => t.role === 'user').map(t => t.content).join(" ");
        const reportPrompt = `Assess the user's debate performance based on these arguments:
        "${userTurns}"
        
        Return JSON ONLY:
        {
            "logicScore": (1-100),
            "vocabularyScore": (1-100),
            "fluencyScore": (1-100),
            "summary": "2-3 sentences summing up their strengths and weaknesses."
        }`;

        const reportRes = await generateContent(reportPrompt, true);
        let reportData = { logicScore: 0, vocabularyScore: 0, fluencyScore: 0, summary: "Good effort!" };

        try {
            const jsonMatch = reportRes.match(/\{[\s\S]*\}/);
            if (jsonMatch) reportData = JSON.parse(jsonMatch[0]);
        } catch (e) { console.error("JSON Parse Error", e); }

        session.finalFeedback = reportData;
        session.endedAt = Date.now();
        await session.save();

        res.json(reportData);

    } catch (err) {
        next(err);
    }
});

module.exports = router;

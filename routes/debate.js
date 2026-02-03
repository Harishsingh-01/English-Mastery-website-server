const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const DebateSession = require('../models/DebateSession');
const { generateContent } = require('../utils/aiHelper');
const { checkQuota, incrementUsage } = require('../middleware/quota');

// Start a new debate
router.post('/start', auth, checkQuota, async (req, res) => {
    const { topic, difficulty = 'medium' } = req.body;

    try {
        let selectedTopic = topic;
        let openingStatement = "";

        if (!selectedTopic) {
            if (difficulty === 'easy') {
                const randomSeed = Math.random();
                topicPrompt = `You are a topic generator for beginner English learners.
                Generate a completely new, random, simple debate topic.
                Random Seed: ${randomSeed} (Use this to ensure variety).

                Constraints:
                - Max 4-7 words.
                - Use only simple vocabulary (A1 Level).
                - NEVER generate topics about "Cats" or "Dogs" (User is bored of them).
                - VARY the subject (School, Food, Technology, Hobbies, Travel).
                
                Examples of allowed topics:
                - "Pizza is better than burgers"
                - "Morning is better than night"
                - "We should read more books"
                - "Cooking is a useful skill"
                - "Traveling is good for you"
                
                Return ONLY the topic sentence.`;
            }

            selectedTopic = await generateContent(topicPrompt);
            await incrementUsage(req.user.id);
        }

        // Generate opening statement
        const openingPrompt = `You are debating about "${selectedTopic}". 
        Difficulty Level: ${difficulty}.
        
        Your Goal: Start the debate with a very simple opinion.
        
        CRITICAL INSTRUCTION FOR EASY MODE:
        - If difficulty is 'easy', use ONLY Kindergarten/A1 level English.
        - Use extremely simple words like "good", "bad", "like", "hate".
        - MAX 2 SENTENCES.
        - Example: "I like dogs. They are fun friends."
        
        For other difficulties, adjust accordingly.
        Return ONLY your opening statement.`;

        openingStatement = await generateContent(openingPrompt);
        await incrementUsage(req.user.id);

        const session = new DebateSession({
            user: req.user.id,
            topic: selectedTopic,
            difficulty,
            turns: [{
                role: 'ai',
                content: openingStatement
            }]
        });

        await session.save();

        res.json({
            sessionId: session._id,
            topic: selectedTopic,
            openingStatement
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Process a user turn
router.post('/turn', auth, checkQuota, async (req, res) => {
    const { sessionId, message } = req.body;

    try {
        const session = await DebateSession.findById(sessionId);
        if (!session) return res.status(404).json({ msg: 'Session not found' });
        if (session.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Unauthorized' });

        // 1. Analyze User Input (Quick Feedback)
        const feedbackPrompt = `Analyze this user argument in a debate about "${session.topic}".
        User Argument: "${message}"

        Return JSON ONLY:
        {
            "coherenceScore": (1-10 integer, how logical?),
            "grammarScore": (1-10 integer),
            "feedback": "1 sentence quick tip"
        }`;

        const feedbackRes = await generateContent(feedbackPrompt, true);
        await incrementUsage(req.user.id);

        let feedbackData = { coherenceScore: 0, grammarScore: 0, feedback: "Keep going!" };
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

        let rebuttalInstructions = `Maintain a ${session.difficulty} vocabulary level.`;
        if (session.difficulty === 'easy') {
            rebuttalInstructions = `STRICTLY use A1/Kindergarten English. 
            - Use short sentences (5-8 words max).
            - NO big words.
            - Start with simple phrases like "I think", "But", "No".`;
        }

        const rebuttalPrompt = `You are debating about "${session.topic}".
        Current Dialogue:
        ${context}

        Your Goal: Rebut the opponent's last point. 
        ${rebuttalInstructions}
        Return ONLY your text response.`;

        const rebuttal = await generateContent(rebuttalPrompt);
        await incrementUsage(req.user.id);

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
        console.error(err);
        res.status(500).send('Server Error');
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
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

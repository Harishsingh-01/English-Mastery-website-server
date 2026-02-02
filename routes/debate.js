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
            // Generate a topic
            let topicPrompt = `Generate a controversial but safe topic for an English debate practice session. 
            Difficulty: ${difficulty}. 
            Return ONLY the topic sentence.`;

            if (difficulty === 'easy') {
                topicPrompt = `You are a topic generator for English learners.
                Generate a very simple, common debate topic.
                STRICTLY choose ONLY from these subjects: 
                1. Traditional Marketing vs Digital Marketing
                2. Online Shopping vs Offline Shopping
                3. Is AI taking jobs? / Is AI good?
                4. Work from Home vs Office
                5. City Life vs Village Life
                
                Do NOT generate complex political or abstract topics. Keep it very simple.
                Return ONLY the topic sentence.`;
            }

            selectedTopic = await generateContent(topicPrompt);
            await incrementUsage(req.user.id);
        }

        // Generate opening statement
        const openingPrompt = `You are a skilled debater. 
        Topic: "${selectedTopic}". 
        Difficulty Level: ${difficulty} (Easy = very simple words, short sentences. Hard = complex, academic).
        
        Your goal: Challenge the user to argue against you.
        
        Provide a short 2-3 sentence opening statement introducing your specific stance on this topic.
        Make it engaging and provoke a response.
        IMPORTANT: Adjust your vocabulary to match the ${difficulty} level exactly.`;

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
        const rebuttalPrompt = `You are debating about "${session.topic}".
        Current Dialogue:
        ${context}

        Your Goal: Rebut the opponent's last point. Be concise (max 3 sentences). 
        Maintain a ${session.difficulty} vocabulary level (Easy = simple words, short sentences).
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

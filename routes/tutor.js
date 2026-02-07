const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { generateContent } = require('../utils/aiHelper');

const TutorSession = require('../models/TutorSession');

// Generic AI Chat Endpoint
router.post('/chat', auth, async (req, res, next) => {
    try {
        const { message, history } = req.body; // history: [{ role: 'user'|'ai', content: '...' }]

        // Limit history context to last 6 messages
        const recentHistory = history ? history.slice(-6) : [];

        // Construct Prompt
        let contextPrompt = "";
        if (recentHistory.length > 0) {
            contextPrompt = "Previous conversation for context:\n";
            recentHistory.forEach(msg => {
                contextPrompt += `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.content}\n`;
            });
        }

        const prompt = `You are a helpful, friendly, and knowledgeable AI English Tutor.
        ${contextPrompt}
        
        User: "${message}"
        
        Respond to the user naturally. Correct any grammar mistakes if they are significant, but prioritize keeping the conversation flowing. 
        If you correct a mistake, do it gently at the end of your response.
        Keep your response concise and engaging.`;

        const responseText = await generateContent(prompt);

        // --- Persistence Logic ---
        // Find recent session (active within last 1 hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        let session = await TutorSession.findOne({
            user: req.user.id,
            lastUpdated: { $gt: oneHourAgo }
        }).sort({ lastUpdated: -1 });

        if (!session) {
            session = new TutorSession({
                user: req.user.id,
                messages: []
            });
        }

        session.messages.push({ role: 'user', content: message });
        session.messages.push({ role: 'ai', content: responseText });
        session.lastUpdated = Date.now();
        await session.save();

        res.json({ reply: responseText });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

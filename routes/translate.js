const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { generateContent } = require('../utils/aiHelper');
const { checkQuota, incrementUsage } = require('../middleware/quota');

router.post('/', auth, checkQuota, async (req, res) => {
    const { text, targetLang } = req.body;

    if (!text) {
        return res.status(400).json({ msg: 'Please provide text to translate' });
    }

    try {
        const prompt = `Translate the following text to ${targetLang === 'hi' ? 'Hindi' : 'English'}.
        If the target is English, ensure it is natural and grammatically correct.
        If the target is Hindi, use natural spoken Hindi script (Devanagari).
        Return ONLY the translated text, no other commentary.
        
        Text: "${text}"`;

        const translatedText = await generateContent(prompt);
        await incrementUsage(req.user.id);

        res.json({ translation: translatedText.trim() });

    } catch (err) {
        if (err.status) return res.status(err.status).json({ msg: err.message });
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

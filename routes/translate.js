const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { generateContent } = require('../utils/aiHelper');

router.post('/', auth, async (req, res, next) => {
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

        res.json({ translation: translatedText.trim() });

    } catch (err) {
        next(err);
    }
});

module.exports = router;

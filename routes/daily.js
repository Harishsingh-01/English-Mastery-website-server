const express = require('express');
const router = express.Router();
const DailyWord = require('../models/DailyWord');
const { generateContent } = require('../utils/aiHelper');
const auth = require('../middleware/auth');

// @route   GET /api/daily/word
// @desc    Get the word of the day (Cached in DB)
// @access  Private
router.get('/word', auth, async (req, res) => {
    try {
        // Get today's date string (YYYY-MM-DD)
        const today = new Date().toISOString().split('T')[0];

        // 1. Check DB Cache
        let daily = await DailyWord.findOne({ date: today });

        if (daily) {
            return res.json(daily);
        }

        // 2. If not found, Generate with AI
        console.log("Generating new Daily Word for:", today);

        const prompt = `
        Generate an interesting, useful English "Word of the Day" for an English learner.
        It should be an Intermediate to Advanced (B2/C1) word that is commonly used in professional or daily conversation.
        Avoid extremely obscure words.
        
        Return JSON ONLY:
        {
            "word": "Resilient",
            "pronunciation": "/rɪˈzɪl.jənt/ • adjective",
            "definition": "Able to withstand or recover quickly from difficult conditions.",
            "hindiMeaning": "लचीला (Lachila) - कठिनाइयों से जल्दी उबरने वाला",
            "examples": [
                "She is remarkably resilient.",
                "The economy has proven to be resilient."
            ]
        }
        `;

        const aiResponse = await generateContent(prompt, true); // JSON mode

        // Clean and Parsing Logic (Reusing safe parsing)
        let cleanResponse = aiResponse.trim();
        if (cleanResponse.startsWith('```json')) {
            cleanResponse = cleanResponse.replace(/^```json/, '').replace(/```$/, '');
        } else if (cleanResponse.startsWith('```')) {
            cleanResponse = cleanResponse.replace(/^```/, '').replace(/```$/, '');
        }

        const data = JSON.parse(cleanResponse);

        // 3. Save to DB
        daily = new DailyWord({
            date: today,
            word: data.word,
            pronunciation: data.pronunciation,
            definition: data.definition,
            hindiMeaning: data.hindiMeaning,
            examples: data.examples
        });

        await daily.save();

        res.json(daily);

    } catch (err) {
        console.error("Daily Word Error:", err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

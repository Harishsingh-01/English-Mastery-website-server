const express = require('express');
const router = express.Router();
const DailyWord = require('../models/DailyWord');
const auth = require('../middleware/auth');
const { generateContent } = require('../utils/aiHelper');

// Helper: Get the Monday of the current week (for week identification)
function getWeekStart(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when Sunday
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0]; // Returns YYYY-MM-DD of Monday
}

// @route   GET /api/daily/word
// @desc    Get the word of the day (Weekly AI generation + daily rotation)
// @access  Private
router.get('/word', auth, async (req, res) => {
    try {
        // Get today's date string (YYYY-MM-DD)
        const today = new Date().toISOString().split('T')[0];

        // 1. Check if today's word is already cached
        let daily = await DailyWord.findOne({ date: today });

        if (daily) {
            return res.json(daily);
        }

        // 2. Check if this week's words are already generated
        const weekStart = getWeekStart();
        const weekWords = await DailyWord.find({
            date: { $gte: weekStart }
        }).sort({ date: 1 });

        if (weekWords.length === 7) {
            // Week already generated, find today's word
            daily = weekWords.find(w => w.date === today);
            if (daily) {
                return res.json(daily);
            }
        }

        // 3. Generate new week's words with AI (only happens once per week!)
        console.log(`Generating new week's words starting from: ${weekStart}`);

        const prompt = `Generate 7 unique, interesting English "Word of the Day" entries for an English learner (one for each day of the week).
        Words should be INTERMEDIATE level (B1-B2), NOT advanced or difficult words.
        Choose words that are:
        - Commonly used in daily conversation and workplace
        - Easy to understand and remember
        - Practical and useful for learners
        - Mix of adjectives, verbs, and nouns
        
        AVOID: Rare, academic, or overly complex words.
        PREFER: Common, practical words like "efficient", "organize", "confident", "improve", etc.
        
        Return STRICT JSON ONLY (array of 7 objects):
        [
            {
                "word": "Confident",
                "pronunciation": "/ˈkɒn.fɪ.dənt/ • adjective",
                "definition": "Feeling or showing certainty about something; self-assured.",
                "hindiMeaning": "आत्मविश्वासी (Aatmavishwasi) - अपने आप पर यकीन रखने वाला",
                "examples": [
                    "She felt confident before the interview.",
                    "He is a confident speaker."
                ]
            },
            // ... 6 more INTERMEDIATE level words
        ]`;

        const aiResponse = await generateContent(prompt, true); // JSON mode

        // Clean and parse response
        let cleanResponse = aiResponse.trim();
        if (cleanResponse.startsWith('```json')) {
            cleanResponse = cleanResponse.replace(/^```json/, '').replace(/```$/, '');
        } else if (cleanResponse.startsWith('```')) {
            cleanResponse = cleanResponse.replace(/^```/, '').replace(/```$/, '');
        }

        const weekData = JSON.parse(cleanResponse);

        if (!Array.isArray(weekData) || weekData.length !== 7) {
            throw new Error('AI did not return 7 words');
        }

        // 4. Save all 7 words to DB (Monday-Sunday)
        const mondayDate = new Date(weekStart);
        const savedWords = [];

        for (let i = 0; i < 7; i++) {
            const wordDate = new Date(mondayDate);
            wordDate.setDate(mondayDate.getDate() + i);
            const dateStr = wordDate.toISOString().split('T')[0];

            const wordDoc = new DailyWord({
                date: dateStr,
                word: weekData[i].word,
                pronunciation: weekData[i].pronunciation,
                definition: weekData[i].definition,
                hindiMeaning: weekData[i].hindiMeaning,
                examples: weekData[i].examples
            });

            await wordDoc.save();
            savedWords.push(wordDoc);

            // If this is today, set it as the return value
            if (dateStr === today) {
                daily = wordDoc;
            }
        }

        console.log(`✅ Generated and saved 7 words for week starting ${weekStart}`);

        // 5. Return today's word
        if (!daily) {
            // Edge case: today might be before the week start
            daily = savedWords[0];
        }

        res.json(daily);

    } catch (err) {
        console.error("Daily Word Error:", err);
        res.status(500).json({ msg: 'Failed to generate daily word', error: err.message });
    }
});

module.exports = router;

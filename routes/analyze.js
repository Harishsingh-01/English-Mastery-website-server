const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const SentenceHistory = require('../models/SentenceHistory');
const Mistake = require('../models/Mistake');
const { generateContent } = require('../utils/aiHelper');
const { incrementUsage } = require('../middleware/quota');




router.post('/', auth, async (req, res, next) => {
    const { sentence, strictMode } = req.body;

    if (!sentence) {
        return res.status(400).json({ msg: 'Please provide a sentence' });
    }

    if (sentence.length > 500) {
        return res.status(400).json({ msg: 'Sentence too long (max 500 characters)' });
    }

    try {
        let systemInstruction = "Correct the following English sentence(s) and highlight mistakes.";
        if (strictMode) {
            systemInstruction += " STRICTLY check for: 1. Capitalization (start of sentence, 'I', proper nouns). 2. Punctuation (must end with . ? !). 3. Extra whitespace (double spaces, trailing spaces). Flag EVERY single one of these issues as a separate mistake.";
        }

        const prompt = `${systemInstruction} Return JSON ONLY.
    Sentence: "${sentence}"
    Required JSON Format:
    {
      "original": "${sentence}",
      "corrected": "Corrected sentence here.",
      "polished_alternatives": [
        "Professional version 1...",
        "Professional version 2...",
        "Professional version 3..."
      ],
      "mistakes": [ // If strictMode is on, include ALL capitalization/punctuation errors here
        {
          "wrong": "wrong phrase",
          "correct": "correct phrase",
          "category": "grammar/spelling/preposition/punctuation/capitalization",
          "rule": "Explanation of the rule",
          "explanation": "Why it is wrong"
        }
      ]
    }
    If there are no mistakes, "mistakes" should be an empty array. Always provide polished alternatives even if the sentence is correct.`;

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ msg: 'Gemini API Key missing' });
        }

        const responseText = await generateContent(prompt, true);
        let text = responseText;
        // Cleanup JSON
        const match = text.match(/\{[\s\S]*\}/);
        if (match) text = match[0];

        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            console.error("AI Analysis Parse Failed", text);
            return res.status(500).json({
                msg: 'AI response parsing failed',
                raw: responseText.substring(0, 100) + "..."
            });
        }

        // Save Mistakes
        const mistakeIds = [];
        if (result.mistakes && result.mistakes.length > 0) {
            for (const m of result.mistakes) {
                if (!m.wrong || !m.correct) continue;

                // Upsert mistake
                let mistake = await Mistake.findOne({ userId: req.user.id, wrongPhrase: m.wrong });
                if (mistake) {
                    mistake.count += 1;
                    mistake.lastSeen = Date.now();
                    await mistake.save();
                    mistakeIds.push(mistake._id);
                } else {
                    const newMistake = new Mistake({
                        userId: req.user.id,
                        wrongPhrase: m.wrong,
                        correctPhrase: m.correct,
                        rule: m.rule,
                        category: m.category,
                        explanation: m.explanation
                    });
                    await newMistake.save();
                    mistakeIds.push(newMistake._id);
                }
            }
        }

        // Save History
        const history = new SentenceHistory({
            userId: req.user.id,
            original: result.original,
            corrected: result.corrected,
            mistakes: mistakeIds
        });
        await history.save();

        res.json(result);

    } catch (err) {
        next(err);
    }
});

// Generate examples for a rule
router.post('/examples', auth, async (req, res, next) => {
    const { rule, mistake } = req.body;
    try {
        const prompt = `Provide 3 clear, simple sentences demonstrating the correct usage of the following English grammar rule.
        Rule: "${rule}"
        Context of mistake: "${mistake}"
        
        Return ONLY a JSON array of strings: e.g. ["Example 1", "Example 2", "Example 3"]`;

        const responseText = await generateContent(prompt, true);
        await incrementUsage(req.user.id); let text = responseText;

        // Cleanup JSON
        const match = text.match(/\[[\s\S]*\]/);
        if (match) text = match[0];

        res.json(JSON.parse(text));
    } catch (err) {
        next(err);
    }
});

// Get user stats (Mistakes, Improvement, etc.)
router.get('/stats', auth, async (req, res, next) => {
    try {
        const totalMistakes = await Mistake.countDocuments({ userId: req.user.id });
        const totalChecks = await SentenceHistory.countDocuments({ userId: req.user.id });

        // Get top 5 most frequent mistakes
        const topMistakes = await Mistake.find({ userId: req.user.id })
            .sort({ count: -1 })
            .limit(5);

        // Calculate improvement (mock logic or real if simplified)
        // For now, just return activity count as a simple metric
        res.json({
            totalMistakes,
            totalSentences: totalChecks,
            topMistakes
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

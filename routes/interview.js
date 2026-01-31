const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const multer = require('multer');
const fs = require('fs');


const InterviewSession = require('../models/InterviewSession');
const Mistake = require('../models/Mistake');
const { generateContent } = require('../utils/aiHelper');
const { checkQuota, incrementUsage } = require('../middleware/quota');

const upload = multer({ dest: 'uploads/' });

// --- Helper: PDF Extraction (Bypassing pdf-parse) ---
async function extractText(buffer) {
    try {
        // Dynamic import for ESM module in CJS
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

        // Convert buffer to Uint8Array
        const uint8Array = new Uint8Array(buffer);
        const loadingTask = getDocument({ data: uint8Array, verbosity: 0 });
        const doc = await loadingTask.promise;

        let fullText = '';
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }
        return fullText.trim();
    } catch (error) {
        console.error('PDF Extraction Error:', error);
        return ''; // Fail gracefully
    }
}

// --- Session Management ---

// 1. Start New Session (Optional Resume)
router.post('/start', auth, upload.single('resume'), async (req, res) => {
    try {
        let resumeText = '';
        if (req.file) {
            const dataBuffer = fs.readFileSync(req.file.path);
            resumeText = await extractText(dataBuffer);
            fs.unlinkSync(req.file.path); // Cleanup
        }

        const session = new InterviewSession({
            user: req.user.id,
            resumeContext: resumeText,
            messages: []
        });
        await session.save();
        res.json(session);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 2. Get User History
router.get('/history', auth, async (req, res) => {
    try {
        const sessions = await InterviewSession.find({ user: req.user.id })
            .sort({ lastUpdated: -1 })
            .select('title lastUpdated createdAt');
        res.json(sessions);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 3. Get Specific Session
router.get('/session/:id', auth, async (req, res) => {
    try {
        const session = await InterviewSession.findById(req.params.id);
        if (!session) return res.status(404).json({ msg: 'Session not found' });
        if (session.user.toString() !== req.user.id) return res.status(401).json({ msg: 'Not authorized' });
        res.json(session);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// --- AI Interactions (Updated with Context) ---

// Get a random interview question
router.post('/question', auth, checkQuota, async (req, res) => {
    try {
        const { type, sessionId, length } = req.body; // length: 'short', 'medium', 'long'

        let context = '';
        if (sessionId) {
            const session = await InterviewSession.findById(sessionId);
            if (session && session.resumeContext) {
                context = `Candidate Resume Context: "${session.resumeContext.substring(0, 1000)}..."`;
            }
        }

        const lengthPrompt = length === 'short' ? 'Keep the question concise and short.' :
            length === 'long' ? 'Ask a detailed, multi-part question.' : '';

        const prompt = `Generate a random 1 single interview question for a ${type || 'general'} interview context. 
        ${context}
        ${lengthPrompt}
        It should be challenging but fair. Return ONLY the question string.`;

        const questionText = await generateContent(prompt); // plain text response
        await incrementUsage(req.user.id);

        // Save to session if exists
        if (sessionId) {
            await InterviewSession.findByIdAndUpdate(sessionId, {
                $push: { messages: { role: 'ai', content: questionText } },
                $set: { lastUpdated: Date.now() }
            });
        }

        res.json({ question: questionText });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ msg: err.message });
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Evaluate answer
router.post('/evaluate', auth, checkQuota, async (req, res) => {
    const { question, answer, sessionId, length } = req.body;
    try {
        const lengthPrompt = length === 'short' ? 'Keep your feedback and better answer concise.' : '';

        const prompt = `You are an expert interviewer.
        Question: "${question}"
        Candidate Answer: "${answer}"
        ${lengthPrompt}
        
        Evaluate the answer. Provide:
        1. A score out of 10.
        2. Feedback on grammar and tone.
        3. A "Better Answer" example.
        
        Return STRICT JSON format (no markdown code blocks, no newlines in strings):
        {
            "score": 8,
            "feedback": "...",
            "betterAnswer": "...",
            "mistakes": [
                { "wrong": "...", "right": "...", "rule": "..." }
            ]
        }`;

        const responseText = await generateContent(prompt, true);
        await incrementUsage(req.user.id);

        // Helper to extract JSON from text
        const extractJSON = (text) => {
            const match = text.match(/\{[\s\S]*\}/);
            return match ? match[0] : text;
        };

        const text = extractJSON(responseText);

        // Clean up the text to ensure valid JSON
        text = extractJSON(text);

        const evaluation = JSON.parse(text);

        // --- Save Mistakes to DB ---
        if (evaluation.mistakes && Array.isArray(evaluation.mistakes)) {
            for (const m of evaluation.mistakes) {
                // Validate mistake object structure from AI
                if (!m.wrong || !m.right) continue;

                // Upsert mistake
                await Mistake.findOneAndUpdate(
                    {
                        userId: req.user.id,
                        wrongPhrase: m.wrong
                    },
                    {
                        $set: {
                            correctPhrase: m.right,
                            rule: m.rule || 'General Grammar Rule', // Fallback
                            lastSeen: Date.now()
                        },
                        $inc: { count: 1 }
                    },
                    { upsert: true, new: true }
                );
            }
        }

        // Save to session if exists
        if (sessionId) {
            await InterviewSession.findByIdAndUpdate(sessionId, {
                $push: {
                    messages: {
                        role: 'user',
                        content: answer,
                        evaluation: evaluation
                    }
                },
                $set: { lastUpdated: Date.now() }
            });
        }

        res.json(evaluation);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ msg: err.message });
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

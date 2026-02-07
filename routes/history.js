const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const SentenceHistory = require('../models/SentenceHistory');
const InterviewSession = require('../models/InterviewSession');
const RoleplaySession = require('../models/RoleplaySession');
const TutorSession = require('../models/TutorSession');
const DebateSession = require('../models/DebateSession');

// @route   GET /api/history
// @desc    Get merged history from all types
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch all in parallel
        const [practice, interview, roleplay, tutor, debate] = await Promise.all([
            SentenceHistory.find({ userId }).sort({ createdAt: -1 }).limit(20).populate('mistakes').lean(),
            InterviewSession.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
            RoleplaySession.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
            TutorSession.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
            DebateSession.find({ user: userId }).sort({ startedAt: -1 }).limit(10).lean()
        ]);

        // Normalize data structure
        const normalizedPractice = practice.map(p => ({
            id: p._id,
            type: 'practice',
            date: p.createdAt,
            title: 'Grammar Check',
            preview: p.original.substring(0, 50) + '...',
            details: p
        }));

        const normalizedInterview = interview.map(i => ({
            id: i._id,
            type: 'interview',
            date: i.createdAt,
            title: 'Interview Session',
            preview: i.messages.length > 0 ? i.messages[0].content.substring(0, 50) + '...' : 'Empty session',
            details: i
        }));

        const normalizedRoleplay = roleplay.map(r => ({
            id: r._id,
            type: 'roleplay',
            date: r.createdAt,
            title: `Roleplay: ${r.scenario}`,
            preview: r.messages.length > 0 ? r.messages[0].content.substring(0, 50) + '...' : 'Empty session',
            details: r
        }));

        const normalizedTutor = tutor.map(t => ({
            id: t._id,
            type: 'tutor',
            date: t.createdAt,
            title: 'AI Tutor Chat',
            preview: t.messages.length > 0 ? t.messages[0].content.substring(0, 50) + '...' : 'Empty session',
            details: t
        }));

        const normalizedDebate = debate.map(d => ({
            id: d._id,
            type: 'debate',
            date: d.startedAt,
            title: `Debate: ${d.topic}`,
            preview: d.turns.length > 0 ? d.turns[0].content.substring(0, 50) + '...' : 'Empty debate',
            details: d
        }));

        // Merge and sort by date descending
        const merged = [...normalizedPractice, ...normalizedInterview, ...normalizedRoleplay, ...normalizedTutor, ...normalizedDebate]
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(merged);
    } catch (err) {
        next(err);
    }
});

module.exports = router;

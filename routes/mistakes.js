const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Mistake = require('../models/Mistake');
const SentenceHistory = require('../models/SentenceHistory');

// Get all mistakes for user
router.get('/', auth, async (req, res, next) => {
    try {
        const mistakes = await Mistake.find({ userId: req.user.id }).sort({ lastSeen: -1 });
        res.json(mistakes);
    } catch (err) {
        next(err);
    }
});

// Get stats
router.get('/stats', auth, async (req, res, next) => {
    try {
        const totalMistakes = await Mistake.countDocuments({ userId: req.user.id });
        const totalSentences = await SentenceHistory.countDocuments({ userId: req.user.id });

        // Most frequent mistakes
        const topMistakes = await Mistake.find({ userId: req.user.id })
            .sort({ count: -1 })
            .limit(5);

        res.json({
            totalMistakes,
            totalSentences,
            topMistakes
        });
    } catch (err) {
        next(err);
    }
});

// Delete a mistake
router.delete('/:id', auth, async (req, res, next) => {
    try {
        const mistake = await Mistake.findById(req.params.id);

        if (!mistake) {
            return res.status(404).json({ msg: 'Mistake not found' });
        }

        // Ensure user owns the mistake
        if (mistake.userId.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized' });
        }

        await Mistake.findByIdAndDelete(req.params.id);

        res.json({ msg: 'Mistake removed' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

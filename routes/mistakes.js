const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Mistake = require('../models/Mistake');
const SentenceHistory = require('../models/SentenceHistory');

// Get all mistakes for user
router.get('/', auth, async (req, res) => {
    try {
        const mistakes = await Mistake.find({ userId: req.user.id }).sort({ lastSeen: -1 });
        res.json(mistakes);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Get stats
router.get('/stats', auth, async (req, res) => {
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
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Delete a mistake
router.delete('/:id', auth, async (req, res) => {
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
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Mistake not found' });
        }
        res.status(500).send('Server Error');
    }
});

module.exports = router;

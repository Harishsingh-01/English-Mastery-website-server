const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Flashcard = require('../models/Flashcard');

// @route   GET api/flashcards
// @desc    Get all user flashcards
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const flashcards = await Flashcard.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(flashcards);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/flashcards
// @desc    Add a new flashcard
// @access  Private
router.post('/', auth, async (req, res) => {
    const { word, definition, example, pronunciation } = req.body;

    try {
        const newFlashcard = new Flashcard({
            user: req.user.id,
            word,
            definition,
            example,
            pronunciation
        });

        const flashcard = await newFlashcard.save();
        res.json(flashcard);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/flashcards/:id
// @desc    Update flashcard mastery
// @access  Private
router.put('/:id', auth, async (req, res) => {
    const { mastery } = req.body;

    try {
        let flashcard = await Flashcard.findById(req.params.id);

        if (!flashcard) return res.status(404).json({ msg: 'Flashcard not found' });

        // Make sure user owns flashcard
        if (flashcard.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized' });
        }

        flashcard = await Flashcard.findByIdAndUpdate(
            req.params.id,
            { $set: { mastery, nextReview: Date.now() } }, // Logic for Spaced Repetition could be improved here later
            { new: true }
        );

        res.json(flashcard);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE api/flashcards/:id
// @desc    Delete flashcard
// @access  Private
router.delete('/:id', auth, async (req, res) => {
    try {
        let flashcard = await Flashcard.findById(req.params.id);

        if (!flashcard) return res.status(404).json({ msg: 'Flashcard not found' });

        // Make sure user owns flashcard
        if (flashcard.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized' });
        }

        await Flashcard.findByIdAndDelete(req.params.id);

        res.json({ msg: 'Flashcard removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

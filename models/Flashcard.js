const mongoose = require('mongoose');

const FlashcardSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    word: {
        type: String,
        required: true,
        trim: true
    },
    definition: {
        type: String,
        required: true
    },
    example: {
        type: String
    },
    pronunciation: {
        type: String
    },
    mastery: {
        type: Number,
        default: 0, // 0 = New, 1 = Learning, 2 = Reviewing, 3 = Mastered
        min: 0,
        max: 3
    },
    nextReview: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Flashcard', FlashcardSchema);

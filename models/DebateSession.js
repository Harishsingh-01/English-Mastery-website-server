const mongoose = require('mongoose');

const DebateSessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    topic: {
        type: String,
        required: true
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        default: 'medium'
    },
    turns: [{
        role: { type: String, enum: ['user', 'ai'], required: true },
        content: { type: String, required: true },
        analysis: { // Optional analysis for user turns
            coherenceScore: Number, // 1-10
            grammarScore: Number, // 1-10
            feedback: String
        },
        timestamp: { type: Date, default: Date.now }
    }],
    finalFeedback: {
        logicScore: Number,
        vocabularyScore: Number,
        fluencyScore: Number,
        summary: String
    },
    startedAt: {
        type: Date,
        default: Date.now
    },
    endedAt: Date
});

module.exports = mongoose.model('DebateSession', DebateSessionSchema);

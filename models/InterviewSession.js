const mongoose = require('mongoose');

const InterviewSessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        default: 'New Interview Session'
    },
    resumeContext: {
        type: String, // Extracted text from resume
        default: ''
    },
    messages: [
        {
            role: { type: String, enum: ['ai', 'user', 'system'], required: true },
            content: { type: String, required: true },
            evaluation: { type: Object }, // Store evaluation result if available
            timestamp: { type: Date, default: Date.now }
        }
    ],
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('InterviewSession', InterviewSessionSchema);

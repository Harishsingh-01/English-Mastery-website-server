const mongoose = require('mongoose');

const RoleplaySessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scenario: { type: String, required: true },
    messages: [{
        role: { type: String, enum: ['user', 'ai'], required: true },
        content: { type: String, required: true }
    }],
    feedback: {
        score: Number,
        feedback: String,
        improvements: Array
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RoleplaySession', RoleplaySessionSchema);

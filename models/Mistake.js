const mongoose = require('mongoose');

const MistakeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    wrongPhrase: { type: String, required: true },
    correctPhrase: { type: String, required: true },
    rule: { type: String },
    category: { type: String },
    explanation: { type: String },
    count: { type: Number, default: 1 },
    lastSeen: { type: Date, default: Date.now }
});

// Index to easily find existing mistakes for a user
MistakeSchema.index({ userId: 1, wrongPhrase: 1 }, { unique: true });

module.exports = mongoose.model('Mistake', MistakeSchema);

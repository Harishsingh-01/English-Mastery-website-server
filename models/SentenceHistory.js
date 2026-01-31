const mongoose = require('mongoose');

const SentenceHistorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    original: { type: String, required: true },
    corrected: { type: String, required: true },
    mistakes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Mistake' }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SentenceHistory', SentenceHistorySchema);

const mongoose = require('mongoose');

const DailyWordSchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true }, // Format: YYYY-MM-DD
    word: { type: String, required: true },
    pronunciation: { type: String, required: true },
    definition: { type: String, required: true },
    hindiMeaning: { type: String, required: true },
    examples: [{ type: String, required: true }]
});

module.exports = mongoose.model('DailyWord', DailyWordSchema);

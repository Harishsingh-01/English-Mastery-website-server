require('dotenv').config();
const mongoose = require('mongoose');
const DailyWord = require('./models/DailyWord'); // Adjust path if needed

const clearDailyWord = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/english-app');
        console.log('MongoDB Connected');

        const today = new Date().toISOString().split('T')[0];
        const result = await DailyWord.findOneAndDelete({ date: today });

        if (result) {
            console.log(`Deleted Daily Word for ${today}:`, result.word);
        } else {
            console.log(`No Daily Word found for ${today} to delete.`);
        }

        mongoose.disconnect();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

clearDailyWord();

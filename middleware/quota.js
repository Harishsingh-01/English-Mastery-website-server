const User = require('../models/User');

const checkQuota = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const today = new Date();
        const userDate = new Date(user.usage.date);

        // Reset if new day
        if (userDate.getDate() !== today.getDate() || userDate.getMonth() !== today.getMonth()) {
            user.usage.count = 0;
            user.usage.date = today;
            await user.save();
        }

        const LIMIT = 100; // Daily request limit (Increased)

        if (user.usage.count >= LIMIT) {
            return res.status(429).json({ msg: 'Daily AI limit reached. Please try again tomorrow.' });
        }

        req.userStats = user; // Pass user to next middleware/route
        next();
    } catch (err) {
        console.error('Quota Check Error:', err);
        res.status(500).send('Server Error');
    }
};

const incrementUsage = async (userId) => {
    try {
        await User.findByIdAndUpdate(userId, { $inc: { 'usage.count': 1 } });
    } catch (err) {
        console.error('Usage Increment Error:', err);
    }
};

module.exports = { checkQuota, incrementUsage };

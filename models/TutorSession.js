const mongoose = require('mongoose');

const TutorSessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    messages: [
        {
            role: {
                type: String,
                enum: ['user', 'ai'],
                required: true
            },
            content: {
                type: String,
                required: true
            },
            timestamp: {
                type: Date,
                default: Date.now
            }
        }
    ],
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = mongoose.model('TutorSession', TutorSessionSchema);

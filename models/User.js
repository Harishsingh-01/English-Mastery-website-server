const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String }, // Password is optional for Google users
    googleId: { type: String },
    avatar: { type: String },
    usage: {
        count: { type: Number, default: 0 },
        date: { type: Date, default: Date.now }
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);

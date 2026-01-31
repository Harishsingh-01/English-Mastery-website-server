const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');

// @desc    Auth with Google
// @route   GET /auth/google
router.get('/', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

// @desc    Google auth callback
// @route   GET /auth/google/callback
router.get('/callback',
    passport.authenticate('google', { failureRedirect: '/', session: false }),
    (req, res) => {
        // Successful authentication
        const payload = {
            user: {
                id: req.user.id,
                name: req.user.name,
                email: req.user.email,
                avatar: req.user.avatar
            }
        };

        // Create JWT
        jwt.sign(
            payload,
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' },
            (err, token) => {
                if (err) throw err;
                // Redirect to frontend with token
                // Assuming frontend is on port 5173 (Vite default) or 3000
                const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
                res.redirect(`${CLIENT_URL}/login?token=${token}`);
            }
        );
    }
);

module.exports = router;

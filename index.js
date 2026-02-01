require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: [process.env.CLIENT_URL || 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

const passport = require('passport');
require('./config/passport')(passport);
app.set('trust proxy', 1); // Required for Render/Heroku/Vercel (behind proxy)
app.use(passport.initialize());

// Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/english-app')
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log(err));

app.get('/', (req, res) => {
    res.send('API is running...');
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/analyze', require('./routes/analyze'));
app.use('/api/mistakes', require('./routes/mistakes'));
app.use('/api/translate', require('./routes/translate'));
app.use('/api/interview', require('./routes/interview'));
app.use('/api/auth/google', require('./routes/googleAuth'));
app.use('/api/roleplay', require('./routes/roleplay'));
app.use('/api/history', require('./routes/history'));
app.use('/api/daily', require('./routes/daily'));
app.use('/api/tutor', require('./routes/tutor'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

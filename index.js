require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.use(cors({
  origin: [process.env.CLIENT_URL || 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

const passport = require('passport');
require('./config/passport')(passport);
app.set('trust proxy', 1); // Required for Render/Heroku/Vercel (behind proxy)
app.use(passport.initialize());



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
app.use('/api/flashcards', require('./routes/flashcards'));
app.use('/api/debate', require('./routes/debate'));

// --- ERROR HANDLING MIDDLEWARE (Must be after all routes) ---
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Database Connection with retry logic
const connectDB = async (retries = 5) => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected');
  } catch (err) {
    console.error('[MongoDB Connection Error]', err.message);

    if (retries > 0) {
      console.log(`Retrying database connection... (${retries} attempts remaining)`);
      setTimeout(() => connectDB(retries - 1), 5000); // Retry after 5 seconds
    } else {
      console.error('Failed to connect to MongoDB after multiple attempts');
      // Don't exit in production, allow the server to handle errors gracefully
      if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
      }
    }
  }
};

connectDB();

// --- GLOBAL ERROR HANDLERS ---

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Promise Rejection]', {
    reason: reason,
    promise: promise,
    timestamp: new Date().toISOString()
  });
  // Don't crash the server in production
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  // Graceful shutdown
  console.log('Server shutting down due to uncaught exception...');
  process.exit(1);
});
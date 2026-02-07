/**
 * Centralized Error Handler Middleware
 * 
 * Standardizes error responses across all routes with user-friendly messages.
 * Logs errors with context and hides technical details in production.
 */

const errorHandler = (err, req, res, next) => {
    // Log error with request context
    console.error('[Error Handler]', {
        message: err.message,
        status: err.status || 500,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    // Default error values
    let statusCode = err.status || 500;
    let userMessage = err.userMessage || err.msg || 'An unexpected error occurred. Please try again.';

    // --- SPECIFIC ERROR TYPE HANDLING ---

    // 1. MongoDB/Mongoose Errors
    if (err.name === 'CastError') {
        statusCode = 400;
        userMessage = 'Invalid ID format.';
    } else if (err.name === 'ValidationError') {
        statusCode = 400;
        userMessage = Object.values(err.errors)
            .map(e => e.message)
            .join(', ');
    } else if (err.code === 11000) {
        // Duplicate key error
        statusCode = 400;
        const field = Object.keys(err.keyPattern)[0];
        userMessage = `This ${field} is already registered.`;
    } else if (err.name === 'MongoNetworkError' || err.name === 'MongooseServerSelectionError') {
        statusCode = 503;
        userMessage = 'Database connection error. Please try again later.';
    }

    // 2. JWT Errors
    else if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        userMessage = 'Invalid authentication token. Please log in again.';
    } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        userMessage = 'Your session has expired. Please log in again.';
    }

    // 3. Multer Errors (File Upload)
    else if (err.name === 'MulterError') {
        statusCode = 400;
        if (err.code === 'LIMIT_FILE_SIZE') {
            userMessage = 'File size too large. Maximum size is 5MB.';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            userMessage = 'Unexpected file field.';
        } else {
            userMessage = 'File upload error. Please try again.';
        }
    }

    // 4. Custom validation errors
    else if (err.message?.includes('Only PDF files allowed')) {
        statusCode = 400;
        userMessage = 'Only PDF files are allowed.';
    }

    // --- RESPONSE FORMAT ---
    const response = {
        success: false,
        msg: userMessage
    };

    // Include technical details only in development
    if (process.env.NODE_ENV === 'development') {
        response.error = err.message;
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
};

/**
 * 404 Not Found Handler
 * Must be placed after all routes
 */
const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        msg: `Route not found: ${req.method} ${req.path}`
    });
};

module.exports = { errorHandler, notFoundHandler };

import rateLimit from 'express-rate-limit';

// Apply rate-limiting middleware specifically to the /export route
export const rateLimitExport = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Too many requests from this IP, please try again after an hour',
});
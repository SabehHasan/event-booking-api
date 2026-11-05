import { rateLimit } from 'express-rate-limit'

export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,       // 15 minutes
    limit: 5,                       // 5 attempts per IP per window
    standardHeaders: 'draft-7',     // sends RateLimit headers
    legacyHeaders: false,
    skipSuccessfulRequests: true,    // only failed login attempts count
    message: { error: "Too many login attempts, please try again later" }
})
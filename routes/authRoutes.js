import express from 'express'
import { pool } from "../config/db.js";
import { registrationSchema, loginSchema } from '../schemas/userSchemas.js';
import { validateBody } from '../middleware/validateBody.js';
import { loginLimiter } from '../middleware/rateLimiters.js';
import * as argon2 from 'argon2'
import { SignJWT } from 'jose';


const router = express.Router()


router.post('/register', validateBody(registrationSchema), async (req, res) => {
    
    const { username, email, password } = req.body

    try {
        const hashedPassword = await argon2.hash(password)

        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING username, email, role', [username, email, hashedPassword]
        )

        return res.status(201).json(result.rows[0])
    } catch (err) {
        if (err.code === '23505') {
            if(err.constraint === 'users_email_key') {
                return res.status(409).json({ error: 'Email is already in use!'})
            }

            if (err.constraint === 'users_username_key') {
                return res.status(409).json({ error: 'Username is already taken!' })
            }

            return res.status(409).json({ error: 'User already exists' })
        }

        if(err.code === '23514') {
            return res.status(409).json({ error:  'Invalid role selection!'})
        }

        console.log('Register failed: ', err)
        return res.status(500).json({ error: 'Internal server error' })
    }

})

router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
    const { identifier, password } = req.body

    try {
        const result = await pool.query('SELECT id, username, password_hash, role FROM users WHERE email = $1 OR username = $1', [identifier])

        const user = result.rows[0]
        const valid = user && await argon2.verify(user.password_hash, password)

        if(!valid) {
            return res.status(401).json({ error: 'Incorrect email or password'})
        }

        const secret = new TextEncoder().encode(process.env.JWT_SECRET)

        const token = await new SignJWT({})
            .setProtectedHeader({ alg: 'HS256'})
            .setSubject(String(user.id))
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(secret)

        return res.json({ 
            user: {id: user.id, username: user.username, role: user.role },
            accessToken: token,
            tokenType: 'Bearer' 
        })
    } catch (err) {
        console.log('Login failed', err);
        return res.status(500).json({ error: 'Internal server error' })
    }


})



export default router

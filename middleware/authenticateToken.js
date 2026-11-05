import { jwtVerify } from 'jose'
import { pool } from '../config/db.js'

export const authenticateToken = async (req, res, next) => {
    const header = req.headers.authorization
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' })
    }

    try {
        const { payload } = await jwtVerify(header.slice(7), secret, {
            algorithms: ['HS256']
        })

        const result = await pool.query(
            'SELECT id, username, email, role FROM users WHERE id = $1',
            [payload.sub]
        )

        if (result.rowCount === 0) {
            return res.status(401).json({ error: 'Authentication required' })
        }

        req.user = result.rows[0]
        next()
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' })
    }
}
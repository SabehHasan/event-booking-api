import { randomUUID } from 'node:crypto'
import { pool } from '../../config/db.js'

export const createTestUser = async ({
    role = 'attendee',
    passwordHash
}) => {
    const username = `test_${randomUUID()}`
    const email = `${username}@example.test`

    const result = await pool.query(
        `INSERT INTO users
            (username, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, email, role`,
        [username, email, passwordHash, role]
    )

    return result.rows[0]
}


export const createTestEvent = async ({
    organizerId,
    capacity = 10
}) => {
    const result = await pool.query(
        `INSERT INTO events
            (organizer_id, title, starts_at, location, capacity, status)
         VALUES ($1, $2, $3, $4, $5, 'scheduled')
         RETURNING *`,
        [
            organizerId,
            `Test Event ${randomUUID()}`,
            new Date(Date.now() + 86400000).toISOString(),
            'Test Location',
            capacity
        ]
    )

    return result.rows[0]
}
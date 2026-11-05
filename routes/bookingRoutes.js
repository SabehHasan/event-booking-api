import express from 'express'
import { pool } from '../config/db.js'
import * as z from 'zod'
import { authenticateToken } from '../middleware/authenticateToken.js'

const router = express.Router()

const eventIdSchema = z.coerce.number().int().positive()

class BookingError extends Error {
    constructor(status, message) {
        super(message)
        this.status = status
    }
}

router.use(authenticateToken)

router.post('/:id/bookings', async (req, res) => {
    const parsedId = eventIdSchema.safeParse(req.params.id)
    if (!parsedId.success) {
        return res.status(400).json({ error: 'Invalid event id' })
    }

    const eventId = parsedId.data


    const client = await pool.connect()

    try {
        await client.query('BEGIN')

        const eventResult = await client.query(
            `SELECT capacity, status, starts_at > NOW() AS upcoming FROM events WHERE id = $1 FOR UPDATE`,[eventId]
        )

        const event = eventResult.rows[0]

        if (!event) throw new BookingError(404, 'Event not found')
        if (event.status !== 'scheduled' || !event.upcoming) {
            throw new BookingError(409, 'This event is not open for booking')
        }

        const existing = await client.query(`SELECT 1 FROM bookings WHERE event_id = $1 AND user_id = $2`, [eventId, req.user.id])

        if (existing.rowCount > 0) {
            throw new BookingError(409, 'You have already booked this event')
        }

        const countResult = await client.query(`SELECT COUNT(*)::int AS booked FROM bookings WHERE event_id = $1`, [eventId])

        const booked = countResult.rows[0].booked
        if (booked >= event.capacity) {
            throw new BookingError(409, 'This event is full')
        }

        const inserted = await client.query(`INSERT INTO bookings (event_id, user_id) VALUES ($1, $2) RETURNING user_id, event_id, booked_at`, [eventId, req.user.id])

        await client.query('COMMIT')

        return res.status(201).json({
            ...inserted.rows[0],
            spots_remaining: event.capacity - booked - 1
        })
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {})

        if (err instanceof BookingError) {
            return res.status(err.status).json({ error: err.message })
        }

        if (err.code === '23505') {
            return res.status(409).json({ error: 'You have already booked this event' })
        }
        throw err
    } finally {
        client.release()
    }
})

router.delete('/:id/bookings', async (req, res) => {
    const parsedId = eventIdSchema.safeParse(req.params.id)
    if (!parsedId.success) {
        return res.status(400).json({ error: 'Invalid event id' })
    }

    const result = await pool.query(`
        DELETE FROM bookings AS b
        USING events AS e
        WHERE b.event_id = e.id
        AND b.event_id = $1
        AND b.user_id = $2
        AND e.starts_at > NOW()
        RETURNING b.user_id, b.event_id;`,
        [parsedId.data, req.user.id]
    )

    if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Booking not found' })
    }

    return res.status(204).send()
})

router.get('/me/bookings', async (req, res) => {
    const result = await pool.query(
        `SELECT e.id AS event_id, e.title, e.starts_at, e.location, e.status, b.booked_at
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.user_id = $1
         ORDER BY e.starts_at`,
        [req.user.id]
    )

    return res.json(result.rows)
})



export default router

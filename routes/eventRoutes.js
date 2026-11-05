import express from "express";
import { pool } from '../config/db.js'
import { authenticateToken } from "../middleware/authenticateToken.js";
import { createEventSchema, updateEventSchema } from "../schemas/eventSchemas.js";
import { validateBody } from "../middleware/validateBody.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import * as z from 'zod'

const router = express.Router()

class HttpError extends Error {
    constructor(status, message) {
        super(message)
        this.status = status
    }
}
const eventIdSchema = z.coerce.number().int().positive()


router.get('/', async (req, res) => {
    const result = await pool.query("SELECT * FROM events WHERE status = 'scheduled' AND starts_at > NOW() ORDER BY starts_at ASC")
    res.json(result.rows)
})

router.get('/:id', async (req, res) => {
    const result = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id])
    
    if (!result.rows[0]) {
        return res.status(404).json({ error: "Event was not found" })
    }

    res.json(result.rows[0])
})

router.use(authenticateToken) // protected routes

router.post('/', authorizeRoles('organizer'), validateBody(createEventSchema), async (req, res) => {
    const { title, description, starts_at, location, capacity } = req.body
    
        const result = await pool.query(
        `INSERT INTO events (organizer_id, title, description, starts_at, location, capacity, status) VALUES ($1, $2, $3, $4, $5, $6, 'scheduled') 
        RETURNING id, organizer_id, title, description, starts_at, location, capacity, status`,
        [req.user.id, title, description ?? null, starts_at, location, capacity]

        )
        return res.status(201).json(result.rows[0])
})

router.patch('/:id', authorizeRoles('organizer'), validateBody(updateEventSchema), async (req, res) => {
    const parsedId = eventIdSchema.safeParse(req.params.id)
    if (!parsedId.success) {
        return res.status(400).json({ error: 'Invalid event id' })
    }
    const eventId = parsedId.data
    const { title, description, starts_at, location, capacity } = req.body

    const client = await pool.connect()

    try {
        await client.query('BEGIN')

        const eventResult = await client.query(
            'SELECT status FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE',
            [eventId, req.user.id]
        )
        const event = eventResult.rows[0]

        if (!event) throw new HttpError(404, 'Event not found')
        if (event.status !== 'scheduled') {
            throw new HttpError(409, 'Only scheduled events can be edited')
        }

        
        if (capacity !== undefined) {
            const countResult = await client.query(
                'SELECT COUNT(*)::int AS booked FROM bookings WHERE event_id = $1',
                [eventId]
            )
            const booked = countResult.rows[0].booked
            if (capacity < booked) {
                throw new HttpError(409, `Capacity cannot be lower than the ${booked} existing bookings`)
            }
        }

        const result = await client.query(
            `UPDATE events SET
                title       = COALESCE($2, title),
                description = COALESCE($3, description),
                starts_at   = COALESCE($4, starts_at),
                location    = COALESCE($5, location),
                capacity    = COALESCE($6, capacity)
             WHERE id = $1
             RETURNING *`,
            [eventId, title ?? null, description ?? null, starts_at ?? null, location ?? null, capacity ?? null]
        )

        await client.query('COMMIT')
        return res.status(200).json(result.rows[0])
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {})

        if (err instanceof HttpError) {
            return res.status(err.status).json({ error: err.message })
        }
        throw err
    } finally {
        client.release()
    }
})

router.patch('/:id/cancel', authorizeRoles('organizer'), async (req, res) => {
    const result = await pool.query(
        `UPDATE events
        SET status = 'cancelled'
        WHERE id = $1
        AND organizer_id = $2
        AND status = 'scheduled'
        RETURNING *`,
        [req.params.id, req.user.id]
    )

    if (result.rows.length === 0) {
        return res.status(404).json({
            error: 'Event not found or unavailable for cancellation'
        })
    }

    return res.status(200).json(result.rows[0])
    }
)

export default router

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import app from '../app.js'
import { pool } from '../config/db.js'
import * as argon2 from 'argon2'
import { createTestUser, createTestEvent } from './helpers/fixtures.js'

test('POST /events/:id/bookings rejects unauthenticated requests', async () => {
    // Safety check
    const db = await pool.query(
        'SELECT current_database() AS name'
    )

    assert.equal(db.rows[0].name, 'event_booking_test')

    // Attempt a booking without a JWT
    const response = await request(app)
        .post('/events/1/bookings')

    assert.equal(response.status, 401)
})

test('Attendee can book, avoid duplicates, and cancel a reservation', async (t) => {
    let organizer
    let attendee
    let event

    // Clean up this test's records afterward
    t.after(async () => {
        if (event) {
            await pool.query('DELETE FROM events WHERE id = $1', [event.id])
        }

        if (attendee) {
            await pool.query('DELETE FROM users WHERE id = $1', [attendee.id])
        }

        if (organizer) {
            await pool.query('DELETE FROM users WHERE id = $1', [organizer.id])
        }
    })

    // Protect against accidentally writing to the real database
    const db = await pool.query('SELECT current_database() AS name')
    assert.equal(db.rows[0].name, 'event_booking_test')

    // Prepare test data
    const password = 'test-password-12345'
    const passwordHash = await argon2.hash(password)

    organizer = await createTestUser({
        role: 'organizer',
        passwordHash
    })

    attendee = await createTestUser({ passwordHash })

    event = await createTestEvent({
        organizerId: organizer.id,
        capacity: 10
    })

    // Authenticate the attendee
    const login = await request(app)
        .post('/auth/login')
        .send({
            identifier: attendee.email,
            password
        })

    assert.equal(login.status, 200)

    // Book the event
    const response = await request(app)
        .post(`/events/${event.id}/bookings`)
        .set('Authorization', `Bearer ${login.body.accessToken}`)

    assert.equal(response.status, 201)

    // Verify the booking exists in PostgreSQL
    const result = await pool.query(
        `SELECT * FROM bookings
         WHERE user_id = $1 AND event_id = $2`,
        [attendee.id, event.id]
    )

    assert.equal(result.rowCount, 1)

    // Attempt to book the same event again
    const secondResponse = await request(app)
        .post(`/events/${event.id}/bookings`)
        .set('Authorization', `Bearer ${login.body.accessToken}`)

    assert.equal(secondResponse.status, 409)

    // Verify that only one booking exists
    const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total
        FROM bookings
        WHERE user_id = $1 AND event_id = $2`,
        [attendee.id, event.id]
    )

    assert.equal(countResult.rows[0].total, 1)

    // Cancel the booking
    const cancellationResponse = await request(app)
        .delete(`/events/${event.id}/bookings`)
        .set('Authorization', `Bearer ${login.body.accessToken}`)

    assert.equal(cancellationResponse.status, 204)

    // Verify the booking was deleted
    const remainingBookings = await pool.query(
        `SELECT * FROM bookings
        WHERE user_id = $1 AND event_id = $2`,
        [attendee.id, event.id]
    )

    assert.equal(remainingBookings.rowCount, 0)
})

test('Concurrent attendees cannot overbook an event', async (t) => {
    let organizer
    let firstAttendee
    let secondAttendee
    let event

    // Clean up this test's records afterward
    t.after(async () => {
        if (event) {
            await pool.query(
                'DELETE FROM events WHERE id = $1',
                [event.id]
            )
        }

        for (const user of [firstAttendee, secondAttendee, organizer]) {
            if (user) {
                await pool.query(
                    'DELETE FROM users WHERE id = $1',
                    [user.id]
                )
            }
        }
    })

    // Safety check
    const db = await pool.query(
        'SELECT current_database() AS name'
    )

    assert.equal(db.rows[0].name, 'event_booking_test')

    // Prepare test users
    const password = 'test-password-12345'
    const passwordHash = await argon2.hash(password)

    organizer = await createTestUser({
        role: 'organizer',
        passwordHash
    })

    firstAttendee = await createTestUser({ passwordHash })
    secondAttendee = await createTestUser({ passwordHash })

    // Create an event with only one available spot
    event = await createTestEvent({
        organizerId: organizer.id,
        capacity: 1
    })

    // Log in both attendees
    const firstLogin = await request(app)
        .post('/auth/login')
        .send({
            identifier: firstAttendee.email,
            password
        })

    const secondLogin = await request(app)
        .post('/auth/login')
        .send({
            identifier: secondAttendee.email,
            password
        })

    assert.equal(firstLogin.status, 200)
    assert.equal(secondLogin.status, 200)

    // Both attendees attempt to book the only spot concurrently
    const [firstBooking, secondBooking] = await Promise.all([
        request(app)
            .post(`/events/${event.id}/bookings`)
            .set(
                'Authorization',
                `Bearer ${firstLogin.body.accessToken}`
            ),

        request(app)
            .post(`/events/${event.id}/bookings`)
            .set(
                'Authorization',
                `Bearer ${secondLogin.body.accessToken}`
            )
    ])

    // Exactly one request should succeed
    const statuses = [
        firstBooking.status,
        secondBooking.status
    ].sort((a, b) => a - b)

    assert.deepEqual(statuses, [201, 409])

    // Verify PostgreSQL contains exactly one booking
    const result = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM bookings
         WHERE event_id = $1`,
        [event.id]
    )

    assert.equal(result.rows[0].total, 1)
})

after(async () => {
    await pool.end()
})
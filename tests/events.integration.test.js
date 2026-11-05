import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as argon2 from 'argon2'
import request from 'supertest'
import app from '../app.js'
import { pool } from '../config/db.js'
import { createTestUser } from './helpers/fixtures.js'


let organizerId
let organizerToken
let attendeeId
let attendeeToken

let attendeeEmail 
let organizerEmail


const organizerPassword = 'test-password-12345'

before(async () => {
    // Safety check
    const db = await pool.query(
        'SELECT current_database() AS name'
    )

    assert.equal(db.rows[0].name, 'event_booking_test')

    // Hash the test password
    const passwordHash = await argon2.hash(organizerPassword)

    // Create test users using our helper
    const organizer = await createTestUser({
        role: 'organizer',
        passwordHash
    })

    const attendee = await createTestUser({
        passwordHash
    })

    // Save user information
    organizerId = organizer.id
    organizerEmail = organizer.email

    attendeeId = attendee.id
    attendeeEmail = attendee.email

    // Log in as attendee
    const loginResponse = await request(app)
        .post('/auth/login')
        .send({
            identifier: attendeeEmail,
            password: organizerPassword
        })

    assert.equal(loginResponse.status, 200)

    attendeeToken = loginResponse.body.accessToken
    assert.equal(typeof attendeeToken, 'string')

    // Log in as organizer
    const organizerLogin = await request(app)
        .post('/auth/login')
        .send({
            identifier: organizerEmail,
            password: organizerPassword
        })

    assert.equal(organizerLogin.status, 200)

    organizerToken = organizerLogin.body.accessToken
    assert.equal(typeof organizerToken, 'string')
})


test('GET /events returns an array', async () => {
    // Confirm we're connected to the test database
    const db = await pool.query(
        'SELECT current_database() AS name'
    )

    assert.equal(db.rows[0].name, 'event_booking_test')

    // Send an HTTP request
    const response = await request(app).get('/events')

    // Verify the response
    assert.equal(response.status, 200)
    assert.ok(Array.isArray(response.body))
})

test('POST /events rejects unauthenticated requests', async () => {
    const response = await request(app)
        .post('/events')
        .send({
            title: 'Test Event',
            starts_at: '2027-01-15T10:00:00Z',
            location: 'Erbil',
            capacity: 20
        })

    assert.equal(response.status, 401)
})

test('Organizer can log in and receive a JWT', async () => {
    const response = await request(app)
        .post('/auth/login')
        .send({
            identifier: organizerEmail,
            password: organizerPassword
        })

    assert.equal(response.status, 200)
    assert.equal(typeof response.body.accessToken, 'string')
})

let testEventId

test('Organizer can create an event', async () => {
    const response = await request(app)
        .post('/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
            title: 'Integration Test Event',
            description: 'Created by an automated test',
            starts_at: new Date(Date.now() + 86400000).toISOString(),
            location: 'Test Location',
            capacity: 10
        })

    assert.equal(response.status, 201)
    assert.equal(response.body.organizer_id, organizerId)
    assert.equal(response.body.title, 'Integration Test Event')

    testEventId = response.body.id
})

// Close database connections after testing
after(async () => {
    try {
        if (testEventId !== undefined) {
            await pool.query(
            'DELETE FROM events WHERE id = $1',
            [testEventId]
            )
        }
        if (organizerId !== undefined) {
            await pool.query(
                'DELETE FROM users WHERE id = $1',
                [organizerId]
            )
        }
        if (attendeeId !== undefined) {
            await pool.query(
            'DELETE FROM users WHERE id = $1',
            [attendeeId]
            )
        }
    } finally {
        await pool.end()
    }
})
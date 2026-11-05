# Event Booking API

A RESTful backend for managing events and reservations. Organizers can create and manage events, while signed-in users can reserve available spots, view their bookings, and cancel reservations before an event starts.

Built with **Node.js, Express 5, and PostgreSQL**, with particular attention to JWT authentication, role-based authorization, database constraints, and concurrency-safe booking.

## Features

- Account registration and login using an email address or username
- Password hashing and verification with Argon2
- Short-lived JWT access tokens (15 minutes)
- `attendee` and `organizer` account roles
- Public browsing of upcoming scheduled events and individual event details
- Organizer-owned event creation, editing, and soft cancellation
- Booking creation with checks for duplicates, available capacity, and event status/date
- PostgreSQL row locking to protect the last available spot during concurrent requests
- Viewing your own bookings, including bookings for cancelled events
- Removing your own booking before the event starts
- Login rate limiting, Zod request validation, and integration tests

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js (ES modules) |
| HTTP framework | Express 5 |
| Database | PostgreSQL, `pg` connection pool |
| Validation | Zod |
| Authentication | Argon2, JOSE (JWT / HS256) |
| Rate limiting | `express-rate-limit` |
| Tests | Node.js built-in test runner, Supertest |

## Getting started

### Prerequisites

- **Node.js 22+** and npm (recommended; uses Node's native `--env-file` support)
- **PostgreSQL** running locally or accessible over the network

### 1. Install dependencies

```bash
npm install
```

### 2. Create a PostgreSQL database

Create a database named `event_booking` in pgAdmin, or run:

```sql
CREATE DATABASE event_booking;
```

Connect to **`event_booking`** and execute the table definitions in the [Database schema](#database-schema) section. This repository does not currently include a migration runner or SQL schema file, so the tables must be created manually.

### 3. Configure environment variables

Create a `.env` file in the project root:

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=replace_with_your_postgres_password
DB_NAME=event_booking
JWT_SECRET=replace_with_a_long_random_secret
```

Use your own database credentials and a strong, randomly generated JWT secret. **Never commit `.env`, `.env.test`, or real credentials to version control.**

### 4. Start the server

For development, with automatic restart on source changes:

```bash
npm run dev
```

Or start without file watching:

```bash
node --env-file=.env server.js
```

The application listens on **`http://localhost:3000`**. The `npm start` script also runs `server.js`, but unlike `npm run dev`, it **does not load `.env` automatically**; use it only when the environment variables are already supplied by your shell or hosting environment.

## API reference

**Base URL:** `http://localhost:3000`

Protected routes require:

```http
Authorization: Bearer <accessToken>
```

### Authentication

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Public | Register a user |
| `POST` | `/auth/login` | Public | Log in with an email **or** username |

**Register:**

```http
POST /auth/register
Content-Type: application/json
```

```json
{
  "username": "alex",
  "email": "alex@example.com",
  "password": "strong-password-123",
  "role": "attendee"
}
```

`role` is currently **required** and must be either `attendee` or `organizer`. The registration route currently allows users to choose either role; see [Current limitations](#current-limitations) before deploying publicly.

Registration returns `201 Created` with the username, email, and role (not the password hash).

**Log in:**

```http
POST /auth/login
Content-Type: application/json
```

```json
{
  "identifier": "alex@example.com",
  "password": "strong-password-123"
}
```

The `identifier` can be the account's **email address or username**. On success, the API returns `user`, `accessToken`, and `tokenType: "Bearer"`. Tokens expire after **15 minutes**. The login endpoint limits failed attempts to **5 per IP per 15-minute window**.

### Events

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/events` | Public | List **upcoming, scheduled** events, ordered by start time |
| `GET` | `/events/:id` | Public | Get an event by ID, including cancelled or past events |
| `POST` | `/events` | Organizer | Create a scheduled event |
| `PATCH` | `/events/:id` | Owning organizer | Edit a scheduled event |
| `PATCH` | `/events/:id/cancel` | Owning organizer | Soft-cancel a scheduled event |

**Create an event:**

```http
POST /events
Authorization: Bearer <organizer-access-token>
Content-Type: application/json
```

```json
{
  "title": "Backend Workshop",
  "description": "An introduction to building REST APIs",
  "starts_at": "2030-06-15T10:00:00Z",
  "location": "Erbil",
  "capacity": 20
}
```

`title`, `starts_at`, `location`, and `capacity` are required. `description` is optional. `starts_at` must be an ISO 8601 datetime **in the future** with a timezone offset; `capacity` must be a positive integer. The event's `organizer_id` comes from the authenticated user, and its initial status is `scheduled`.

The event edit route allows partial updates of title, description, start time, location, and capacity, provided the event is still scheduled and the organizer owns it. Capacity cannot be reduced below the number of existing bookings. The route locks the event record during the update to coordinate safely with booking operations.

Event cancellation changes `status` to `cancelled` instead of deleting the event. Existing bookings are retained, and the event cannot be cancelled a second time through the same endpoint.

### Bookings

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/events/:id/bookings` | Authenticated user | Reserve a spot in an upcoming scheduled event |
| `DELETE` | `/events/:id/bookings` | Authenticated booking owner | Delete your reservation before the event starts |
| `GET` | `/events/me/bookings` | Authenticated user | List your reservations with their event details |

**Book an event:**

```http
POST /events/1/bookings
Authorization: Bearer <accessToken>
```

No request body is needed. On success the server responds with `201 Created` and booking data including `user_id`, `event_id`, `booked_at`, and `spots_remaining`.

A booking is rejected if the event does not exist, has started, is cancelled, is full, or the user has already booked it. Each `(user_id, event_id)` pair is unique. Booking operations lock the event row inside a database transaction to prevent competing reservations from exceeding the capacity.

**Cancel your booking:**

```http
DELETE /events/1/bookings
Authorization: Bearer <accessToken>
```

A successful deletion returns `204 No Content`. Only the currently authenticated user's booking can be deleted, and only **before** the event starts. This is a **hard delete** of the booking row, not a status change.

**View your bookings:**

```http
GET /events/me/bookings
Authorization: Bearer <accessToken>
```

Returns an array with the event ID, title, start time, location, event status, and booking timestamp. Bookings for organizer-cancelled events remain visible.

## Database schema

Run these statements in your **application database**, in the order shown:

```sql
CREATE TABLE users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'attendee'
        CHECK (role IN ('attendee', 'organizer'))
);

CREATE TABLE events (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    description TEXT,
    starts_at TIMESTAMPTZ NOT NULL,
    location TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'cancelled'))
);

CREATE TABLE bookings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, event_id)
);
```

**Design notes:** An event belongs to an organizer; an organizer cannot be deleted while their events exist (`ON DELETE RESTRICT`). Booking records are unique per user/event pair. Events use soft cancellation; attendee bookings are physically deleted when cancelled. New event creation explicitly supplies `status = 'scheduled'` because the column has no default.

## Running integration tests

Tests use the real API handlers and a **separate PostgreSQL database**.

1. Create a database named exactly **`event_booking_test`**.
2. Execute the same SQL from [Database schema](#database-schema) in the **test database**.
3. Create `.env.test` in the project root, with the same fields as `.env` but `DB_NAME=event_booking_test` and a test JWT secret.
4. Run:

```bash
npm test
```

The test scripts explicitly verify they are connected to `event_booking_test`, create temporary fixtures, and remove them afterward. The test suite currently contains **7 integration tests** covering public event listing, authentication requirements, organizer login and event creation, booking creation and duplicates, cancellation, and competing requests for a single available spot.

**Do not point `.env.test` at your development or production database.**

## Project structure

```text
.
├── app.js                    # Express app, middleware, mounted routes
├── server.js                 # HTTP listener (port 3000)
├── config/
│   └── db.js                 # PostgreSQL connection pool
├── middleware/
│   ├── authenticateToken.js  # JWT verification + user lookup
│   ├── authorizeRoles.js     # Organizer role checks
│   ├── errorHandler.js       # Generic error responses
│   ├── rateLimiters.js       # Login rate limiting
│   └── validateBody.js       # Zod request validation
├── routes/
│   ├── authRoutes.js
│   ├── eventRoutes.js
│   └── bookingRoutes.js
├── schemas/
│   ├── userSchemas.js
│   └── eventSchemas.js
├── tests/
│   ├── events.integration.test.js
│   ├── bookings.integration.test.js
│   └── helpers/
│       └── fixtures.js
└── package.json
```

## HTTP status codes

The API uses standard statuses, including:

| Status | Meaning |
| --- | --- |
| `200` | Successful request |
| `201` | Resource created |
| `204` | Booking deleted successfully (no response body) |
| `400` | Invalid request data |
| `401` | Missing/invalid token or invalid login credentials |
| `403` | Insufficient permissions |
| `404` | Requested event or booking not found |
| `409` | Duplicate booking, no available spots, or other business-rule conflict |
| `429` | Login rate limit exceeded |
| `500` | Unexpected server error |

## Current limitations

This project is a learning-focused backend MVP, not a production-hardened service.

- **Registration authorization:** Public registration currently accepts a requested role, including `organizer`. A public deployment should restrict who can grant organizer privileges.
- **Database setup:** No migration or seed scripts are included; schema creation is manual.
- **Authentication:** Access tokens expire after 15 minutes; there is no refresh-token flow.
- **Scope:** No frontend, payments, email notifications, or waitlists are implemented.

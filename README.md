# Event Booking API

A RESTful backend for creating events and reserving places, built with **Node.js, Express 5, and PostgreSQL**. Organizers manage events, while authenticated users can book available spots and manage their reservations. The API uses JWT authentication, role-based authorization, database transactions, and PostgreSQL row locking to prevent overbooking.

**Deployment:** Express API on **Render**, PostgreSQL on **Neon**, source code on **GitHub**.

> **Live API:** `https://event-booking-api-vf9i.onrender.com/events`

## Features

- Public account registration (new accounts receive the `attendee` role by default)
- Login with **username or email** and Argon2 password verification
- JWT access tokens with a **15-minute** expiry
- Role-based access control for organizer operations
- Public browsing of upcoming scheduled events and individual event details
- Organizer-owned event creation, editing, and soft cancellation
- Reservation creation with duplicate, capacity, start-time, and status checks
- PostgreSQL transactions and `SELECT ... FOR UPDATE` locking to prevent overbooking under concurrent requests
- Viewing your own reservations, including those for organizer-cancelled events
- Cancellation of your own reservation before the event starts
- Zod request validation, login rate limiting, and integration tests

## Technology stack

| Purpose | Technology |
| --- | --- |
| Runtime | Node.js (ES modules) |
| Web framework | Express 5 |
| Database | PostgreSQL with `pg` connection pooling |
| Request validation | Zod |
| Authentication | Argon2 and JOSE (JWT, HS256) |
| Rate limiting | `express-rate-limit` |
| Testing | Node.js built-in test runner and Supertest |
| API hosting | Render |
| Managed PostgreSQL | Neon |
| Source control | Git and GitHub |

## Getting started locally

### Requirements

- Node.js **22+** and npm
- A local PostgreSQL server or a PostgreSQL connection URL

### 1. Install dependencies

```bash
npm ci
```

### 2. Set up the database

Create a local database named `event_booking` (using pgAdmin or another PostgreSQL client):

```sql
CREATE DATABASE event_booking;
```

Connect to that database, then execute the three table definitions in [Database schema](#database-schema), in order.

> The project does not currently have a migration runner. Creating a database does **not** automatically create its tables.

### 3. Configure environment variables

Create `.env` in the project root. For **local PostgreSQL**, use:

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_local_postgres_password
DB_NAME=event_booking
JWT_SECRET=replace_with_a_long_random_secret
```

Alternatively, to connect with a PostgreSQL URL, use:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
JWT_SECRET=replace_with_a_long_random_secret
```

The application uses `DATABASE_URL` **if it is set**; otherwise, it uses the individual `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` variables. When using Neon, copy the full connection string provided by Neon, including its SSL parameters.

Generate a random JWT secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

**Never commit `.env`, `.env.test`, database URLs, JWT secrets, or real credentials to GitHub.**

### 4. Start the API

Development mode (loads `.env` and restarts on changes):

```bash
npm run dev
```

Or run once while explicitly loading `.env`:

```bash
node --env-file=.env server.js
```

The default local address is **`http://localhost:3000`**. The server listens on `process.env.PORT` if provided, which allows deployment on Render.

`npm start` runs `node server.js` but **does not automatically load `.env`**; it is intended for environments where variables are already provided, such as Render.

## API reference

**Local base URL:** `http://localhost:3000`  
**Hosted base URL:** `https://YOUR-RENDER-SERVICE.onrender.com`

For endpoints requiring authentication, send:

```http
Authorization: Bearer YOUR_ACCESS_TOKEN
```

### Authentication

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Public | Register an attendee |
| `POST` | `/auth/login` | Public | Log in using an email or username |

**Register:**

```http
POST /auth/register
Content-Type: application/json
```

```json
{
  "username": "alex",
  "email": "alex@example.com",
  "password": "use-a-unique-password-123"
}
```

Registration returns `201 Created` with the account's username, email, and `role: "attendee"`. The public registration schema **does not accept a `role` field**; organizer permissions must be granted separately by an administrator.

**Log in:**

```http
POST /auth/login
Content-Type: application/json
```

```json
{
  "identifier": "alex@example.com",
  "password": "use-a-unique-password-123"
}
```

`identifier` can be a username or email. A successful response contains user information, `accessToken`, and `tokenType: "Bearer"`. Access tokens expire after **15 minutes**. Failed login attempts are rate-limited (five per IP per 15-minute window).

### Events

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/events` | Public | List upcoming, scheduled events |
| `GET` | `/events/:id` | Public | Get event details, including past/cancelled events |
| `POST` | `/events` | Organizer | Create an event |
| `PATCH` | `/events/:id` | Event owner (organizer) | Update a scheduled event |
| `PATCH` | `/events/:id/cancel` | Event owner (organizer) | Soft-cancel a scheduled event |

**Create an event:**

```http
POST /events
Authorization: Bearer YOUR_ORGANIZER_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "title": "Backend Workshop",
  "description": "An introduction to REST APIs",
  "starts_at": "2030-06-15T10:00:00Z",
  "location": "Erbil",
  "capacity": 20
}
```

Required fields: `title`, `starts_at`, `location`, `capacity`. `description` is optional. The start time must be in the future, with a valid ISO 8601 timestamp and timezone offset. Capacity must be a positive integer. The server assigns the `organizer_id` from the authenticated account and sets the new event's status to `scheduled`.

The owning organizer can edit a scheduled event. If capacity is reduced, the API ensures the new capacity does not fall below existing reservations; it locks the event row while performing this check. Cancelling an event changes its status to `cancelled` rather than deleting the record. Existing bookings are preserved and remain visible to attendees.

### Bookings

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/events/:id/bookings` | Authenticated | Book an upcoming scheduled event |
| `DELETE` | `/events/:id/bookings` | Booking owner | Cancel your own booking before the event starts |
| `GET` | `/events/me/bookings` | Authenticated | See your reservations and event details |

**Book a spot:**

```http
POST /events/1/bookings
Authorization: Bearer YOUR_ACCESS_TOKEN
```

No JSON body is required. A successful booking returns `201 Created` and fields such as `user_id`, `event_id`, `booked_at`, and `spots_remaining`.

The API rejects bookings for non-existent, cancelled, past, or full events, and prevents a user from booking the same event twice. Booking creation uses a database transaction and an event-row lock, so concurrent requests cannot take more spots than capacity allows.

**Cancel your booking:**

```http
DELETE /events/1/bookings
Authorization: Bearer YOUR_ACCESS_TOKEN
```

Returns `204 No Content` on success. Cancellation deletes the booking row and is permitted only for the authenticated booking owner before the event starts.

**View your bookings:**

```http
GET /events/me/bookings
Authorization: Bearer YOUR_ACCESS_TOKEN
```

Returns event details and booking timestamps, including reservations linked to cancelled events.

## Database schema

Run these statements in the target PostgreSQL database **in this order**:

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

The `events.status` column has no database default; the event creation route explicitly inserts `scheduled`. Cancelling an event preserves its row and its bookings, while cancelling an individual booking deletes the booking row.

## Deployment — Render + Neon

This project has been deployed using **Render** for the Express API and **Neon** for PostgreSQL, with Render connected to the GitHub repository.

### Neon (database)

1. Create a Neon PostgreSQL project (the deployment used the **Frankfurt** region).
2. Create the `users`, `events`, and `bookings` tables using the SQL schema above in the **correct Neon database**.
3. Copy its PostgreSQL connection string from the Neon Console. Keep it secret.

### Render (Express API)

Create a Render **Web Service** connected to the GitHub repository with the following settings:

| Setting | Value |
| --- | --- |
| Runtime / language | Node |
| Branch | `main` |
| Region | Frankfurt |
| Build command | `npm ci` |
| Start command | `npm start` |
| Root directory | Project root (leave blank) |
| Instance type | Free tier for learning (if available) |

Configure these environment variables in Render (not in GitHub):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Complete Neon PostgreSQL connection string, including SSL settings |
| `JWT_SECRET` | Long, randomly generated secret; **do not reuse a placeholder** |
| `NODE_ENV` | `production` |

Render supplies `PORT` automatically. The server uses that port or falls back to `3000` locally. Render provides an HTTPS `*.onrender.com` URL; a custom domain is optional.

Deploy from GitHub, then verify:

```http
GET https://YOUR-RENDER-SERVICE.onrender.com/events
```

With no scheduled upcoming events, the response is `[]`. Registration and login can be tested with Postman, followed by authenticated event and booking requests.

**Important:** The Neon production database is separate from your local database and test database. Don't run automated integration tests against production. Free web services may take longer to respond after being inactive.

### Giving an account organizer access

Public registration creates attendees only. To enable an **account you control** to create events, an authorized administrator can update its role using the Neon SQL Editor:

```sql
UPDATE users
SET role = 'organizer'
WHERE email = 'your-organizer@example.com'
RETURNING id, username, email, role;
```

Use a known account and confirm the returned row. **Do not add a public endpoint that lets users grant themselves organizer privileges.**

## Integration tests

Automated integration tests use Node's built-in test runner, Supertest, and a separate PostgreSQL database.

1. Create a database named exactly `event_booking_test`.
2. Create the same three tables in that database using the schema above.
3. Create `.env.test` with `DB_NAME=event_booking_test`, the other `DB_*` connection fields, and a **test** `JWT_SECRET`.
4. Ensure `DATABASE_URL` is **not set** in the environment when running the local test suite (it takes precedence over `DB_*`).
5. Run:

```bash
npm test
```

The tests assert that they are using `event_booking_test`. The **seven integration tests** cover public event listing, authentication enforcement, organizer login and event creation, booking creation, duplicate prevention, cancellation, and concurrent booking attempts for one remaining spot.

**Never run integration tests against your Neon production database.**

## Project structure

```text
.
├── app.js
├── server.js
├── config/
│   └── db.js
├── middleware/
│   ├── authenticateToken.js
│   ├── authorizeRoles.js
│   ├── errorHandler.js
│   ├── rateLimiters.js
│   └── validateBody.js
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
├── package.json
├── package-lock.json
└── README.md
```

## API status codes

| Status | Meaning |
| --- | --- |
| `200` | Successful request |
| `201` | Resource created |
| `204` | Booking deleted (no response body) |
| `400` | Invalid request data |
| `401` | Not authenticated or invalid login |
| `403` | Insufficient role permissions |
| `404` | Event or booking not found |
| `409` | Business-rule conflict (for example duplicate/full booking) |
| `429` | Login rate limit exceeded |
| `500` | Unexpected server error |

## Current scope and limitations

This is a deployed **learning-project MVP**, not a fully hardened commercial booking platform.

- Database tables are created manually; there are no migration/seed scripts yet.
- JWT access tokens expire after 15 minutes; refresh tokens and password-reset workflows are not implemented.
- Organizer access is assigned manually; there is no admin dashboard.
- No frontend, payment processing, email notifications, or waitlists.
- Additional operational hardening, monitoring, and security reviews would be required before unrestricted public/commercial use.

## License

`package.json` declares the ISC license. If you want to formally publish the project under that license, add a matching `LICENSE` file.

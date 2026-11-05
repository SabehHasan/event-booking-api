import express from 'express'

import authRoutes from './routes/authRoutes.js'
import eventRoutes from './routes/eventRoutes.js'
import bookingRoutes from './routes/bookingRoutes.js'
import { errorHandler } from './middleware/errorHandler.js'

const app = express()

app.use(express.json())

app.use('/auth', authRoutes)
app.use('/events', eventRoutes)
app.use('/events', bookingRoutes)

app.use(errorHandler)

export default app
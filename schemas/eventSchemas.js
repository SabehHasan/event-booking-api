import * as z from 'zod'

export const createEventSchema = z.strictObject({
    title: z.string().trim().min(1, 'title is required').max(150, 'title is too long'),
    description: z.string().trim().max(5000, 'description is too long').optional(),
    starts_at: z.iso.datetime({ offset: true, error: 'starts_at must be a valid ISO date-time' })
        .refine((value) => new Date(value) > new Date(), 'starts_at must be in the future'),
    location: z.string().trim().min(1, 'location is required').max(255, 'location is too long'),
    capacity: z.number().int('capacity must be a whole number').positive('capacity must be greater than 0')
        .max(2147483647, 'capacity is too large')
})

export const updateEventSchema = createEventSchema
    .partial()
    .extend({ status: z.enum(['scheduled', 'cancelled']).optional() })
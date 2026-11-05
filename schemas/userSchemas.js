import * as z from 'zod'

export const registrationSchema = z.strictObject({
    username: z.string().max(30, 'username is too long').trim().toLowerCase(),
    email: z.email().trim().toLowerCase(),
    password: z.string().min(12, 'password is too short'),
    role: z.string().trim().toLowerCase()
    
})

export const loginSchema = z.strictObject({
    identifier: z.string().trim().toLowerCase().min(1, 'username or email is required'),
    password: z.string().min(1, 'password is required').max(72, 'password is too long')
})

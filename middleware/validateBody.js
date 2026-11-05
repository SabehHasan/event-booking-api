import * as z from 'zod'

export const validateBody = (schema) => {
    return (req, res, next) => {
        const parsedReq = schema.safeParse(req.body)
        
        if(!parsedReq.success) {
            return res.status(400).json({ 
                error: 'Validation failed',
                fields: z.flattenError(parsedReq.error).fieldErrors 
            })
        }
        
        req.body = parsedReq.data
        next()
    }
}
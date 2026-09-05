import { z } from 'zod';
import { email } from './common.js';
export const loginBody = z.object({ email: email.optional(), work_email: email.optional(),
  password: z.string().min(1, 'Enter your password').max(200) })
  .transform((v) => ({ ...v, email: v.email || v.work_email }))
  .refine((v) => !!v.email, { message: 'Work email is required', path: ['email'] });
export const changePasswordBody = z.object({ current_password: z.string().min(1).max(200), new_password: z.string().min(8, 'Use at least 8 characters').max(200) });

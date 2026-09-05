import { z } from 'zod';
import { email } from './common.js';
export const loginBody = z.object({ email: email.optional(), work_email: email.optional(),
  password: z.string().min(1, 'Enter your password').max(200) })
  .transform((v) => ({ ...v, email: v.email || v.work_email }))
  .refine((v) => !!v.email, { message: 'Work email is required', path: ['email'] });
/** The other half of an invitation: the token in the link, and the password the new person chose. */
export const setPasswordBody = z.object({
  token: z.string().trim().min(12, 'The link is incomplete — copy it from the whole e-mail'),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
}).refine((v) => !/[\s"']/.test(v.password), { message: 'No spaces or quotes in a password', path: ['password'] });
export const inviteTokenParam = z.object({ token: z.string().trim().min(12).max(200) });
export const changePasswordBody = z.object({ current_password: z.string().min(1).max(200), new_password: z.string().min(8, 'Use at least 8 characters').max(200) });

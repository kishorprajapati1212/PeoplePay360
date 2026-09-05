import { z } from 'zod';
import { uuid } from './common.js';
export const idParam = (name = 'id') => z.object({ [name]: uuid });

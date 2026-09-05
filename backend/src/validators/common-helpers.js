import { z } from 'zod';
import { uuid } from './common.js';
export const idParam = (name = 'id') => z.object({ [name]: uuid });
export const idParams = (...names) => z.object(Object.fromEntries(names.map((n) => [n, uuid])));

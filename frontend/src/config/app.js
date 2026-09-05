// Everything the UI needs to know about the world outside itself, in one place.
export const APP_NAME = 'PeoplePay360';
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';
export const TOKEN_KEY = 'pp360.token';
export const PAGE_SIZE = 20;
/** The API mints a 5-minute link so a plain <a href> can stream a PDF without the JWT in the URL. */
export const PDF_VIA_TOKEN = true;

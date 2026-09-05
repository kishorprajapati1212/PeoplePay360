/**
 * Which mail server an address lives on.
 *
 * Sending mail needs four facts: a host, a port, whether TLS starts on connect, and the login. Nobody knows the
 * last two, and for the providers below the first two are a published fact — so the app looks them up and you
 * type an address and a password, which is all this screen should ever have asked for.
 *
 * Anything not on this list (a company relay, a cPanel mailbox) still works: the settings screen keeps a host,
 * port and TLS box for exactly that case, and whatever you type there wins over the table below.
 *
 * `appPassword` is the one that saves the most time, because the provider's refusal is cryptic: Google, Apple,
 * Yahoo, Fastmail and QQ will not accept the password you type on their website — they want a generated
 * app-specific one. The sentence that explains it lives here and is used by the settings panel, the mail test
 * and the error hint, so it cannot say something different in two places.
 */

/** Ordered by how likely an Indian payroll box is to use them. */
export const PROVIDERS = [
  {
    key: 'google', brand: 'Google', label: 'Google — Gmail or Google Workspace',
    domains: ['gmail.com', 'googlemail.com'],
    host: 'smtp.gmail.com', port: 465, secure: true, appPassword: true,
    // 'gmail' rather than host+port: nodemailer's Gmail preset also sets the timeouts Gmail behaves best with.
    service: 'gmail',
    note: 'Google needs an App Password: account → Security → 2-Step Verification → App passwords. The password you type on google.com is refused with "Username and Password not accepted". About 500 recipients a day on a personal account.',
  },
  {
    key: 'microsoft', brand: 'Microsoft', label: 'Microsoft — Outlook.com, Hotmail, Live',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.in', 'hotmail.in', 'hotmail.co.in', 'outlook.co.in'],
    host: 'smtp.office365.com', port: 587, secure: false, appPassword: false,
    note: 'Microsoft calls the switch "SMTP AUTH" and turns it off on many tenants; if the connection is refused with the right password, that is the setting to enable.',
  },
  {
    key: 'zoho', brand: 'Zoho', label: 'Zoho Mail',
    domains: ['zoho.com', 'zoho.in', 'zohomail.com', 'zohomail.in'],
    host: 'smtp.zoho.com', port: 465, secure: true, appPassword: false,
    note: 'Zoho needs the per-user SMTP password (Settings → Mail forwarding and POP/IMAP), which is not always the login password.',
  },
  {
    key: 'yahoo', brand: 'Yahoo', label: 'Yahoo',
    domains: ['yahoo.com', 'yahoo.in', 'ymail.com', 'rocketmail.com'],
    host: 'smtp.mail.yahoo.com', port: 465, secure: true, appPassword: true,
    note: 'Generate an app-specific password in your Yahoo account security page.',
  },
  {
    key: 'apple', brand: 'Apple', label: 'Apple — iCloud, me.com',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    host: 'smtp.mail.me.com', port: 465, secure: true, appPassword: true,
    note: 'Create the app-specific password at appleid.apple.com → Sign-In and Security → App-Specific Passwords, and send as the iCloud address that owns it.',
  },
  {
    key: 'fastmail', brand: 'Fastmail', label: 'Fastmail',
    domains: ['fastmail.com', 'messagingengine.com'],
    host: 'smtp.fastmail.com', port: 465, secure: true, appPassword: true,
    note: 'Fastmail wants an app password created in Settings → Privacy & security.',
  },
  {
    key: 'qq', brand: 'QQ Mail', label: 'QQ Mail',
    domains: ['qq.com', 'foxmail.com'],
    host: 'smtp.qq.com', port: 465, secure: true, appPassword: true,
    note: 'QQ Mail needs an authorisation code from Settings → Account → POP3/SMTP service, not the login password.',
  },
];

/** The address decides the server — returns the entry, or null when we do not know this domain. */
export function providerFor(address) {
  const text = String(address ?? '').trim().toLowerCase();
  const at = text.lastIndexOf('@');
  if (at < 0) return null;
  const domain = text.slice(at + 1).replace(/\.$/, '');
  return PROVIDERS.find((p) => p.domains.includes(domain)) || null;
}

/**
 * Hosts that are not a real server: the reserved example domains, and the shapes a placeholder takes when it is
 * copied out of a form, a README or a .env comment. A known address beats one of these — which is what makes a
 * box left holding `smtp.reply.example` send mail, instead of failing with ENOTFOUND forever.
 */
const PLACEHOLDER_PATTERNS = [
  /(^|\.)(example|example\.com|example\.net|example\.org|test|invalid)$/i,   // RFC 2606: resolves to nothing
  /(your[-_]?domain|your[-_]?company|your[-_]?host|changeme|change-me|placeholder|fixme)/i,
];
export function isPlaceholderHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  return !!h && PLACEHOLDER_PATTERNS.some((p) => p.test(h));
}

/**
 * The sentence that tells a short "App Password" what it is missing. Length only is looked at — never the value —
 * and 16 is the shape Google, Apple and the others hand out (four groups of four). A paste that lost a group reads
 * as a wrong password everywhere else in the product, so say it where the password is stored.
 */
export function appPasswordShapeHint(brand, length) {
  const n = Number(length) || 0;
  if (!brand || !n || n === 16) return null;
  return `${brand} app passwords are 16 characters, four groups of four; the login on record is ${n}, so it is refused (535) however often it is retyped — select the whole of it when copying, or generate a new one.`;
}

/** 'smtp.gmail.com:465 · implicit TLS' — one wording, used by the status API, the panel and the mail test. */
export function describeServer(server) {
  const host = server?.host;
  if (!host) return null;
  return `${host}:${server.port || (server.secure ? 465 : 587)} · ${server.secure ? 'implicit TLS' : 'STARTTLS'}`;
}

/**
 * The table as data, for the screen that has to say "we will use smtp.gmail.com" while the address is still being
 * typed. It is served rather than copied into the frontend so a provider added here appears there unchanged.
 */
export const providerList = () => PROVIDERS.map(({ key, brand, label, domains, host, port, secure, appPassword, note }) =>
  ({ key, brand, label, domains, host, port, secure, appPassword, note }));

/** 'Google, Microsoft, Zoho, Yahoo, Apple, Fastmail and QQ' — the sentence that explains an unknown domain. */
export const providerNames = () => {
  const brands = PROVIDERS.map((p) => p.brand);
  return brands.slice(0, -1).join(', ') + ' and ' + brands[brands.length - 1];
};

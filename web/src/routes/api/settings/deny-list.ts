// Sensitive setting keys that must never be read or written via the generic
// settings API, even by admins. These are managed by dedicated code paths
// (e.g. instance:jwtSecret by src/auth/jwt.ts, provider keys by the providers
// API). Exposing them here would let an attacker with admin cookies mint
// arbitrary JWTs or exfiltrate provider credentials.
//
// `apikey:` / `apikeyhash:` rows back the API-key store (src/auth/api-key.ts).
// A generic settings PUT to those keys could forge an API key — including an
// admin-ROLE row — bypassing the mint route's canMintRole anti-escalation, or
// desync the canonical row from its hash-index pointer. They are owned solely
// by the mint/verify code path, so they are denied here even to admins.
//
// `oauth:pending:<state>` rows hold a provider-login PKCE code verifier
// (web/src/routes/api/auth/oauth). The verifier must never leave the server.
const DENY_PATTERNS: readonly RegExp[] = [
  /^instance:jwtSecret$/,
  /^provider:apiKey:/,
  /^provider:oauth:/,
  /^apikey:/,
  /^apikeyhash:/,
  /^oauth:pending:/,
];

export function isSensitiveSettingKey(key: string): boolean {
  return DENY_PATTERNS.some((p) => p.test(key));
}

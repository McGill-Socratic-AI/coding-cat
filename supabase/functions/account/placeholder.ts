// The placeholder address every account is created with.
//
// GoTrue will not create a user without an email, so one is supplied — but it
// must say nothing about who the student is. It is 128 bits of randomness at a
// domain from RFC 2606's reserved `.invalid` TLD, which is guaranteed never to
// resolve: nothing can be delivered to it, no reset link can be sent, and it
// cannot be correlated with any real mailbox.
//
// Nothing in the app ever shows this address, and the browser never sends one:
// the account function resolves a username to its auth user itself.

const DEFAULT_DOMAIN = "users.coding-cat.invalid";

/**
 * `ACCOUNT_EMAIL_DOMAIN` only exists for a deployment whose GoTrue is
 * configured to reject unknown domains. Keep it inside `.invalid` or another
 * domain that genuinely cannot receive mail.
 */
export function placeholderDomain(): string {
  const domain = (Deno.env.get("ACCOUNT_EMAIL_DOMAIN") ?? "").trim().toLowerCase();
  return domain.length > 0 ? domain : DEFAULT_DOMAIN;
}

export function generatePlaceholderEmail(domain: string = placeholderDomain()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const local = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `u${local}@${domain}`;
}

/** One email, ready to send. The idempotency key stops a retry from sending the same email twice. */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
}

export interface Mailer {
  /** False when email is not set up: nothing is sent and the site offers nothing that needs email. */
  readonly on: boolean;
  send(mail: Mail): Promise<void>;
}

export const NO_MAIL: Mailer = { on: false, send: async () => undefined };

const RESEND_URL = "https://api.resend.com/emails";

/** Sends through Resend's HTTP API (no SDK): one POST per email, given up after a few seconds. */
export function resendMailer(opts: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Mailer {
  const send = opts.fetch ?? fetch;
  return {
    on: true,
    async send(mail) {
      const res = await send(RESEND_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          ...(mail.idempotencyKey ? { "idempotency-key": mail.idempotencyKey } : {}),
        },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}`);
    },
  };
}

/**
 * Sends in the background: an email that fails never undoes or delays what the
 * customer did. The log line names the kind of email, never the address or content.
 */
export function sendLater(mailer: Mailer, mail: Mail | null, what: string): void {
  if (!mailer.on || !mail) return;
  mailer.send(mail).catch((e: unknown) => {
    console.error(`Email not sent (${what}): ${e instanceof Error ? e.message : "unknown error"}`);
  });
}

// The notifications the owner can receive, in plain words. Shown on Settings > Notifications.
// Keep this in step with the code that sends them (growth/intake.ts, monitoring/rules.ts and alerts/rules.ts).

export interface NotificationEvent {
  title: string;
  when: string;
  example: string;
}

export const NOTIFICATION_EVENTS: NotificationEvent[] = [
  {
    title: "New website lead",
    when: "Within seconds of someone sending the contact form on the Luminate website.",
    example: "New lead: Jane Smith - Acme Bakery - jane@acme.com",
  },
  {
    title: "Payment received",
    when: "Within about 5 minutes of a payment being recorded (the old app records Stripe payments, and this app announces them). Also for one-off payments.",
    example: "Payment received: Acme Bakery - $49.00",
  },
  {
    title: "Payment failed",
    when: "Within about 5 minutes of a failed payment being recorded. Not sent for clients that are on hold or archived. If the payment is later paid, you also get Payment received.",
    example: "Payment failed: Acme Bakery - $49.00 did not go through. Follow up.",
  },
  {
    title: "New client request",
    when: "When a client sends a request from the client portal. Requests you add yourself with Quick Add do not notify you.",
    example: "New request: Acme Bakery - LUM-1052 Update opening hours",
  },
  {
    title: "New client comment",
    when: "When a client comments on a request in the client portal. The comment text is not included.",
    example: "New comment: Acme Bakery - On LUM-1052 Update opening hours",
  },
  {
    title: "Site down",
    when: "As soon as a check finds a client site down. Luminate OS checks every site every 10 minutes (and tries once more before calling a site down) and the alert job looks every 5, so expect it up to about 15 minutes after the site actually goes down.",
    example: "Site down: Acme Bakery (acmebakery.com)",
  },
  {
    title: "Site back up",
    when: "On the first check after a site that was down responds again.",
    example: "Back up: Acme Bakery (acmebakery.com)",
  },
  {
    title: "Certificate or domain expiring",
    when: "Once each at 14, 7, 3 and 1 days before an SSL certificate or domain expires, and once if it has expired.",
    example: "SSL expires in 7 days: Acme Bakery",
  },
  {
    title: "Site checks stalled",
    when: "When any monitored site has not been checked for over an hour, which means the site checks job itself has stopped (see Settings > Automations). Archived, on-hold and monitoring-stopped clients are left out.",
    example: "Site checks look stalled: 3 sites not checked for over an hour",
  },
];

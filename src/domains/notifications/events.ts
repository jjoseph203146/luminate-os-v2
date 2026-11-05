// The notifications the owner can receive, in plain words. Shown on Settings > Notifications.
// Keep this in step with the code that sends them (growth/rules.ts and monitoring/rules.ts).

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
    title: "Site down",
    when: "As soon as a check finds a client site down. The old app checks about every 15 minutes and the alert job looks every 5, so expect it up to about 20 minutes after the site actually goes down.",
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
    when: "When any site has not been checked for over an hour, which means the checker itself has stopped.",
    example: "Site checks look stalled: 3 sites not checked for over an hour",
  },
];

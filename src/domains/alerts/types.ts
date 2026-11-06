/** A payment the old app's Stripe webhook recorded (revenue_events). */
export interface PaymentRow {
  id: string;
  clientId: string | null;
  amount: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

/** A row the client portal writes when a client sends a request or a comment (notifications). */
export interface NoticeRow {
  id: string;
  type: string;
  clientId: string | null;
  requestId: string | null;
  read: boolean;
  createdAt: string;
}

export interface ClientInfo {
  id: string;
  name: string;
  archived: boolean;
  onHold: boolean;
}

export interface RequestInfo {
  id: string;
  displayId: string;
  title: string;
}

export interface AlertStateRow {
  key: string;
  state: string;
}

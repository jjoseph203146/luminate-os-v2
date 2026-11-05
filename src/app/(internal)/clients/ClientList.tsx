"use client";

import Link from "next/link";
import { useState } from "react";
import { Sheet } from "@/ui/Sheet";
import { StatusBadge } from "@/ui/StatusBadge";
import { formatMoney, phoneHref, safeUrl, statusLabel, statusTone } from "@/domains/clients/rules";
import type { ClientListItem } from "@/domains/clients/types";

const button = "inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-line px-3 text-sm font-medium";

export function ClientList({ clients }: { clients: ClientListItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = clients.find((c) => c.id === selectedId) ?? null;
  const tel = phoneHref(selected?.phone);

  return (
    <>
      <ul className="flex flex-col gap-2">
        {clients.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setSelectedId(c.id)}
              className="flex w-full min-h-16 flex-col gap-1 rounded-xl border border-line bg-surface p-3 text-left"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{c.businessName}</span>
                <StatusBadge tone={statusTone(c.status)}>{statusLabel(c.status)}</StatusBadge>
              </span>
              <span className="truncate text-sm text-muted">{c.contactName}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>{c.openRequests} open {c.openRequests === 1 ? "request" : "requests"}</span>
                <span>Site: {c.monitor.label}</span>
                {c.archived && <span>Archived</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Sheet open={selected !== null} onClose={() => setSelectedId(null)} title={selected?.businessName ?? "Client"}>
        {selected && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</StatusBadge>
              {selected.planName && <span className="text-sm text-muted">{selected.planName} · {formatMoney(selected.subscriptionPrice)}/mo</span>}
            </div>
            <p className="text-sm">{selected.contactName}</p>
            <div className="flex gap-2">
              {tel ? <a className={button} href={`tel:${tel}`}>Call</a> : null}
              {tel ? <a className={button} href={`sms:${tel}`}>Text</a> : null}
              <a className={button} href={`mailto:${selected.email}`}>Email</a>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Websites</h3>
              {selected.websites.length === 0 ? (
                <p className="text-sm text-muted">No websites recorded.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {selected.websites.map((w) => {
                    const href = safeUrl(w.url);
                    return (
                      <li key={w.id} className="text-sm">
                        <span className="text-muted">{w.label}: </span>
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-brand underline">
                            {w.url}
                          </a>
                        ) : (
                          <span className="break-all">{w.url}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="text-sm text-muted">
              {selected.openRequests} open {selected.openRequests === 1 ? "request" : "requests"} · Site check: {selected.monitor.label}
            </p>
            <Link
              href={`/clients/${selected.id}`}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-brand px-4 font-semibold text-brand-ink"
            >
              Open workspace
            </Link>
          </div>
        )}
      </Sheet>
    </>
  );
}

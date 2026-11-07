import { NotificationChannel, ChannelSendResult } from "./types";

/** Paid, DLT registration required before any production send in India
 * (architecture v2 §2, §5 open items). Reserved for when WhatsApp/push can't
 * be confirmed delivered (§9) - the last escalation step. Runs as a logged
 * no-op until MSG91_API_KEY is configured. */
export class SmsChannel implements NotificationChannel {
  readonly name = "sms";

  async send(payload: Record<string, unknown>): Promise<ChannelSendResult> {
    const apiKey = process.env.MSG91_API_KEY;
    const to = payload.phone as string | undefined;

    if (!to) {
      return { success: false, error: "no phone number registered for recipient" };
    }
    if (!apiKey) {
      console.log("[notify:sms] DRY RUN (MSG91_API_KEY not configured):", JSON.stringify(payload));
      return { success: true, providerRef: "dry-run" };
    }

    try {
      const res = await fetch("https://control.msg91.com/api/v5/flow/", {
        method: "POST",
        headers: { authkey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          // Placeholder flow-based payload - verify MSG91's actual template
          // and DLT-registered sender id before production use (open item,
          // architecture v2 §13).
          mobiles: to,
          body: String(payload.body ?? ""),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `MSG91 API ${res.status}: ${text}` };
      }
      const json = (await res.json()) as { request_id?: string };
      return { success: true, providerRef: json.request_id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

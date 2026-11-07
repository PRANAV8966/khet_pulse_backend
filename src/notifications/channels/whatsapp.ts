import { NotificationChannel, ChannelSendResult } from "./types";

/** Paid per business-initiated message (architecture v2 §2, §9, §12) -
 * corrected from v1's "free" assumption. Runs as a logged no-op until the
 * WhatsApp Cloud API credentials are configured, so the escalation pipeline
 * is fully testable before a paid account exists. */
export class WhatsAppChannel implements NotificationChannel {
  readonly name = "whatsapp";

  async send(payload: Record<string, unknown>): Promise<ChannelSendResult> {
    const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const to = payload.phone as string | undefined;

    if (!to) {
      return { success: false, error: "no phone number registered for recipient" };
    }
    if (!token || !phoneNumberId) {
      console.log("[notify:whatsapp] DRY RUN (not configured):", JSON.stringify(payload));
      return { success: true, providerRef: "dry-run" };
    }

    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: String(payload.body ?? "") },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `WhatsApp API ${res.status}: ${text}` };
      }
      const json = (await res.json()) as { messages?: { id?: string }[] };
      return { success: true, providerRef: json.messages?.[0]?.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

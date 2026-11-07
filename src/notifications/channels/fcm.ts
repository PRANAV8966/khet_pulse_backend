import { getMessaging } from "firebase-admin/messaging";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { NotificationChannel, ChannelSendResult } from "./types";

function ensureFirebaseApp(): boolean {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return false;

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        // .env stores the key with literal "\n" sequences - must be
        // unescaped before use, a common and easy-to-miss gotcha.
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
  }
  return true;
}

/** Free, unlimited - the primary notification channel (architecture v2 §2,
 * §9). Never falls back to WebSocket as the primary path. Runs as a logged
 * no-op if Firebase isn't configured yet, or the target user has no
 * registered token - both are reported, never silently swallowed. */
export class FcmChannel implements NotificationChannel {
  readonly name = "fcm";

  async send(payload: Record<string, unknown>): Promise<ChannelSendResult> {
    const token = payload.fcmToken as string | undefined;
    if (!token) {
      return { success: false, error: "no fcm token registered for recipient" };
    }
    if (!ensureFirebaseApp()) {
      console.log("[notify:fcm] DRY RUN (Firebase not configured):", JSON.stringify(payload));
      return { success: true, providerRef: "dry-run" };
    }

    try {
      const messageId = await getMessaging().send({
        token,
        notification: {
          title: String(payload.title ?? "khet_pulse alert"),
          body: String(payload.body ?? ""),
        },
        data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)])),
      });
      return { success: true, providerRef: messageId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

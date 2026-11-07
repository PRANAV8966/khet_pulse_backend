export interface ChannelSendResult {
  success: boolean;
  providerRef?: string;
  error?: string;
}

export interface NotificationChannel {
  readonly name: string;
  send(payload: Record<string, unknown>): Promise<ChannelSendResult>;
}

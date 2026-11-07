import { randomUUID } from "crypto";
import { prisma } from "../db/prisma";
import { ConfigService } from "../config/ConfigService";
import { sign } from "../security/hmac";
import { CommandRequestPayload, CommandResponsePayload } from "../mqtt/payloads";
import { isForwardTransition, TERMINAL_COMMAND_STATUSES } from "./statuses";
import { computeExpiresAt } from "./expiry";
import { NotFoundError, ConflictError } from "../errors";

export interface CommandPublisher {
  publishCommand(deviceId: string, payload: CommandRequestPayload): Promise<void>;
}

export interface CreateCommandInput {
  deviceId: string;
  issuedByUserId: string;
  action: "SET_MOTOR_STATE";
  desiredState: "ON" | "OFF";
  /** Client-supplied idempotency key. A retried request with the same
   * commandId after a lost response is a safe no-op, never a second
   * physical operation (architecture v2 §4). */
  commandId?: string;
}

export interface CommandSummary {
  id: string;
  deviceId: string;
  action: string;
  desiredState: string;
  sequence: number;
  status: string;
  issuedAt: string;
  expiresAt: string;
}

function toSummary(row: {
  id: string;
  deviceId: string;
  action: string;
  desiredState: string;
  sequence: number;
  status: string;
  issuedAt: Date;
  expiresAt: Date;
}): CommandSummary {
  return {
    id: row.id,
    deviceId: row.deviceId,
    action: row.action,
    desiredState: row.desiredState,
    sequence: row.sequence,
    status: row.status,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * Command Manager (architecture v2 §4). Desired-state commands, not
 * toggles - a retried/duplicated delivery is a safe no-op. Sequence
 * allocation is serialized per device via a Postgres advisory lock, backed
 * by a DB-level UNIQUE(deviceId, sequence) constraint as defense in depth,
 * so two concurrent START requests for the same device can never be
 * accepted under a colliding sequence number.
 */
export class CommandManager {
  private publisher: CommandPublisher | null = null;

  constructor(private config: ConfigService) {}

  /** Set after construction to avoid a circular constructor dependency with
   * MqttClient (MqttClient itself doesn't depend on CommandManager). */
  setPublisher(publisher: CommandPublisher): void {
    this.publisher = publisher;
  }

  async createCommand(input: CreateCommandInput): Promise<CommandSummary> {
    const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
    if (!device) throw new NotFoundError(`Device ${input.deviceId} not found`);

    // Cheap pre-check outside the lock, purely to reject a commandId reused
    // across a *different* device early - a client error, not a race to
    // protect against. It is NOT relied on for idempotency: two concurrent
    // requests for the same commandId can both pass this check, which is
    // why the authoritative existence check is repeated below, inside the
    // per-device advisory lock.
    if (input.commandId) {
      const precheck = await prisma.deviceCommand.findUnique({ where: { id: input.commandId } });
      if (precheck && precheck.deviceId !== input.deviceId) {
        throw new ConflictError("commandId already used for a different device");
      }
    }

    const commandId = input.commandId ?? randomUUID();
    const expirySeconds = this.config.get<number>("command.expiry_seconds", 60);
    const issuedAt = new Date();
    const expiresAt = computeExpiresAt(issuedAt, expirySeconds);

    const { row: created, isNew } = await prisma.$transaction(async (tx) => {
      // Advisory lock keyed by device id - serializes both sequence
      // allocation AND the idempotency check per device for the lifetime of
      // this transaction, so two concurrent requests with the same
      // commandId can never both attempt an insert (see precheck comment
      // above for why the check must be repeated here, not just before the
      // lock).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.deviceId}))`;

      const existing = await tx.deviceCommand.findUnique({ where: { id: commandId } });
      if (existing) {
        return { row: existing, isNew: false };
      }

      const last = await tx.deviceCommand.findFirst({
        where: { deviceId: input.deviceId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const sequence = (last?.sequence ?? 0) + 1;

      const row = await tx.deviceCommand.create({
        data: {
          id: commandId,
          deviceId: input.deviceId,
          issuedByUserId: input.issuedByUserId,
          action: input.action,
          desiredState: input.desiredState,
          sequence,
          status: "RECEIVED",
          issuedAt,
          expiresAt,
        },
      });

      await tx.commandEvent.create({
        data: { commandId: row.id, status: "RECEIVED" },
      });

      await tx.auditLog.create({
        data: {
          userId: input.issuedByUserId,
          action: "ISSUE_COMMAND",
          deviceId: input.deviceId,
          detail: { commandId: row.id, action: input.action, desiredState: input.desiredState, sequence },
        },
      });

      return { row, isNew: true };
    });

    if (!isNew) {
      return toSummary(created); // idempotent replay - no new command, no new publish
    }

    const commandExpiresAt = created.expiresAt;
    const payload: CommandRequestPayload = {
      command_id: created.id,
      device_id: created.deviceId,
      action: "SET_MOTOR_STATE",
      desired_state: created.desiredState as "ON" | "OFF",
      sequence: created.sequence,
      issued_at: Math.floor(created.issuedAt.getTime() / 1000),
      expires_at: Math.floor(commandExpiresAt.getTime() / 1000),
      hmac: sign(
        {
          deviceId: created.deviceId,
          action: created.action,
          desiredState: created.desiredState,
          sequence: created.sequence,
          expiresAt: Math.floor(commandExpiresAt.getTime() / 1000),
        },
        device.hmacSecretRef
      ),
    };

    if (this.publisher) {
      // Fire-and-forget over MQTT (QoS1 at the transport layer) - delivery
      // is not guaranteed synchronously; the expiry sweep below is what
      // catches a command that never gets a response.
      await this.publisher.publishCommand(created.deviceId, payload);
    }

    return toSummary(created);
  }

  /** Applies the device's own report of a command's outcome. Out-of-order or
   * duplicate responses that would regress an already-further-along status
   * are silently ignored (idempotent, never double-processed). Uses a
   * compare-and-swap update rather than read-check-write: two responses for
   * the same command arriving close together (e.g. ACCEPTED immediately
   * followed by ACTUATING) are otherwise both validated against the same
   * stale read and could race, letting the earlier one overwrite the
   * later/more-advanced status. */
  async handleCommandResponse(deviceId: string, payload: CommandResponsePayload): Promise<void> {
    const command = await prisma.deviceCommand.findUnique({ where: { id: payload.command_id } });
    if (!command || command.deviceId !== deviceId) {
      // Unknown command id, or a device reporting on a command that isn't
      // its own - never trust it.
      return;
    }

    if (!isForwardTransition(command.status, payload.status)) return;

    const result = await prisma.deviceCommand.updateMany({
      where: { id: command.id, status: command.status }, // CAS: only apply if status hasn't moved since we read it
      data: { status: payload.status },
    });
    if (result.count === 0) return; // lost the race - a concurrent response already advanced the status further

    await prisma.commandEvent.create({
      data: { commandId: command.id, status: payload.status, note: payload.note },
    });
  }

  /** Periodic sweep - a command past its expiry with no terminal status yet
   * is marked TIMED_OUT. "No response" is never treated as proof the motor
   * didn't act; it's reported as unknown/timed-out, not as FAILED. */
  async sweepExpiredCommands(): Promise<number> {
    const terminal = Array.from(TERMINAL_COMMAND_STATUSES);
    const expired = await prisma.deviceCommand.findMany({
      where: { expiresAt: { lt: new Date() }, status: { notIn: terminal } },
      select: { id: true },
    });
    if (expired.length === 0) return 0;

    await prisma.$transaction([
      prisma.deviceCommand.updateMany({
        where: { id: { in: expired.map((c) => c.id) } },
        data: { status: "TIMED_OUT" },
      }),
      prisma.commandEvent.createMany({
        data: expired.map((c) => ({ commandId: c.id, status: "TIMED_OUT", note: "no terminal response before expiry" })),
      }),
    ]);
    return expired.length;
  }
}

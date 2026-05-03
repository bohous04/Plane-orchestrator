import pino, { type Logger } from "pino";

const isDev = process.env["NODE_ENV"] !== "production";

export const log: Logger = pino(
  isDev
    ? {
        level: process.env["LOG_LEVEL"] ?? "info",
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }
    : { level: process.env["LOG_LEVEL"] ?? "info" },
);

export type { Logger };

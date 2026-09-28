import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";

import prismaPlugin from "./plugins/prisma.js";
import { requireAuth } from "./middleware/auth.js";

import authRoutes from "./routes/auth.js";
import depositRoutes from "./routes/deposit.js";
import withdrawRoutes from "./routes/withdraw.js";
import webhookRoutes from "./routes/webhook.js";

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(jwt, { secret: process.env.JWT_SECRET || "dev-secret-ganti-ini" });
await fastify.register(prismaPlugin);

fastify.decorate("requireAuth", requireAuth);

// Simpan raw body khusus untuk endpoint webhook (dibutuhkan untuk verifikasi HMAC signature)
fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  req.rawBody = body;
  try {
    const json = body.length ? JSON.parse(body.toString("utf8")) : {};
    done(null, json);
  } catch (err) {
    err.statusCode = 400;
    done(err, undefined);
  }
});

fastify.get("/health", async () => ({ success: true, message: "OK" }));

await fastify.register(authRoutes);
await fastify.register(depositRoutes);
await fastify.register(withdrawRoutes);
await fastify.register(webhookRoutes);

const port = Number(process.env.PORT) || 4000;

fastify
  .listen({ port, host: "0.0.0.0" })
  .then(() => fastify.log.info(`Server jalan di port ${port}`))
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });

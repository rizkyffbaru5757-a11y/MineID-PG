import { verifyWebhookSignature } from "../lib/austinpay.js";
import { creditDepositIfNeeded } from "./deposit.js";

export default async function webhookRoutes(fastify) {
  const { prisma } = fastify;

  fastify.post(
    "/webhook/austinpay",
    {
      // butuh raw body buat verifikasi HMAC, di-config lewat contentTypeParser di server.js
      config: { rawBody: true },
    },
    async (request, reply) => {
      const signature = request.headers["x-austinpay-signature"];
      const rawBody = request.rawBody;

      if (!verifyWebhookSignature(rawBody, signature)) {
        return reply.code(401).send({ success: false, message: "Invalid signature" });
      }

      const { event, data } = request.body || {};

      if (event === "deposit.paid" && data?.transactionId) {
        const deposit = await prisma.deposit.findUnique({
          where: { transactionId: data.transactionId },
        });
        if (deposit) {
          await creditDepositIfNeeded(prisma, deposit);
        }
      }

      // withdraw.approved / withdraw.rejected hanya relevan untuk withdraw manual (bukan instant),
      // jadi tidak diproses di sini karena platform ini pakai jalur instant.

      return reply.code(200).send({ success: true });
    }
  );
}

import { austinpay } from "../lib/austinpay.js";

export default async function depositRoutes(fastify) {
  const { prisma } = fastify;

  // Buat deposit QRIS baru untuk user yang sedang login
  fastify.post(
    "/api/deposit/create",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const { amount } = request.body || {};
      const parsedAmount = Number(amount);

      if (!parsedAmount || parsedAmount <= 0 || !Number.isInteger(parsedAmount)) {
        return reply.code(400).send({ success: false, message: "amount harus bilangan bulat positif" });
      }

      const result = await austinpay.createDeposit(parsedAmount);
      if (!result.success) {
        return reply.code(400).send({ success: false, message: result.message || "Gagal membuat deposit" });
      }

      const d = result.deposit;
      const deposit = await prisma.deposit.create({
        data: {
          userId: request.user.id,
          transactionId: d.transaction_id,
          amount: d.amount,
          status: d.status || "pending",
          qrString: d.qr_string,
          qrImage: d.qr_image,
          expiredAt: d.expired_at ? new Date(d.expired_at) : null,
        },
      });

      return reply.send({ success: true, deposit });
    }
  );

  // Cek status deposit (sumber kebenaran: DB lokal, di-update oleh webhook.
  // Sebagai fallback juga tanya langsung ke AustinPay kalau masih pending).
  fastify.get(
    "/api/deposit/:transactionId/status",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const deposit = await prisma.deposit.findUnique({
        where: { transactionId: request.params.transactionId },
      });

      if (!deposit || deposit.userId !== request.user.id) {
        return reply.code(404).send({ success: false, message: "Deposit tidak ditemukan" });
      }

      if (deposit.status === "pending") {
        const check = await austinpay.checkDeposit(deposit.transactionId);
        if (check.success && check.status && check.status !== deposit.status) {
          const updated = await prisma.deposit.update({
            where: { id: deposit.id },
            data: { status: check.status },
          });
          // Kalau ternyata sudah paid tapi webhook belum sempat masuk, kreditkan saldo di sini juga.
          if (check.status === "paid" && !deposit.paidAt) {
            await creditDepositIfNeeded(prisma, updated);
          }
          return reply.send({ success: true, status: check.status });
        }
      }

      return reply.send({ success: true, status: deposit.status });
    }
  );

  fastify.get(
    "/api/deposit/history",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const page = Number(request.query.page) || 1;
      const limit = Math.min(Number(request.query.limit) || 10, 50);

      const [data, total] = await Promise.all([
        prisma.deposit.findMany({
          where: { userId: request.user.id },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.deposit.count({ where: { userId: request.user.id } }),
      ]);

      return reply.send({ success: true, data, page, limit, total, pages: Math.ceil(total / limit) });
    }
  );
}

/** Kreditkan saldo user sekali saja (idempotent lewat pengecekan paidAt). */
export async function creditDepositIfNeeded(prisma, deposit) {
  const fresh = await prisma.deposit.findUnique({ where: { id: deposit.id } });
  if (fresh.paidAt) return; // sudah pernah dikreditkan sebelumnya

  await prisma.$transaction([
    prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "paid", paidAt: new Date() },
    }),
    prisma.user.update({
      where: { id: deposit.userId },
      data: { balance: { increment: deposit.amount } },
    }),
  ]);
}

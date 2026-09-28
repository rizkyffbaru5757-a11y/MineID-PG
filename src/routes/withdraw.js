import { austinpay } from "../lib/austinpay.js";

export default async function withdrawRoutes(fastify) {
  const { prisma } = fastify;

  fastify.get(
    "/api/withdraw/wallets",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const result = await austinpay.getInstantWithdrawWallets();
      return reply.send(result);
    }
  );

  fastify.get(
    "/api/withdraw/products",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const { wallet } = request.query || {};
      if (!wallet) return reply.code(400).send({ success: false, message: "wallet wajib diisi" });

      const result = await austinpay.getInstantWithdrawProducts(wallet);
      return reply.send(result);
    }
  );

  // Buat withdraw instant: potong saldo lokal dulu, baru eksekusi ke AustinPay.
  // Kalau AustinPay menolak, saldo dikembalikan otomatis.
  fastify.post(
    "/api/withdraw/create",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const { wallet, product_code, phone, nominal } = request.body || {};

      if (!wallet || !product_code || !phone) {
        return reply
          .code(400)
          .send({ success: false, message: "wallet, product_code, dan phone wajib diisi" });
      }

      // Ambil produk buat tahu harga potongnya (fixed atau open_denom)
      const productsResult = await austinpay.getInstantWithdrawProducts(wallet);
      if (!productsResult.success) {
        return reply.code(400).send({ success: false, message: "Gagal mengambil daftar produk" });
      }

      const product = productsResult.products.find((p) => p.code === product_code);
      if (!product) {
        return reply.code(400).send({ success: false, message: "product_code tidak valid untuk wallet ini" });
      }

      let totalDeducted;
      let finalNominal;

      if (product.open_denom) {
        const n = Number(nominal);
        if (!n || n < product.min || n > product.max) {
          return reply.code(400).send({
            success: false,
            message: `nominal harus antara Rp${product.min.toLocaleString("id-ID")} - Rp${product.max.toLocaleString("id-ID")}`,
          });
        }
        finalNominal = n;
        totalDeducted = n + product.fee; // estimasi lokal; harga pasti tetap dari sisi AustinPay
      } else {
        finalNominal = product.nominal;
        totalDeducted = product.sell_price;
      }

      const user = await prisma.user.findUnique({ where: { id: request.user.id } });
      if (user.balance < totalDeducted) {
        return reply.code(400).send({ success: false, message: "Saldo tidak mencukupi" });
      }

      // Potong saldo dulu (pesimis), balikin kalau gagal
      await prisma.user.update({
        where: { id: user.id },
        data: { balance: { decrement: totalDeducted } },
      });

      const withdrawResult = await austinpay.createInstantWithdraw({
        wallet,
        product_code,
        phone,
        nominal: product.open_denom ? finalNominal : undefined,
      });

      if (!withdrawResult.success) {
        // refund saldo karena gagal
        await prisma.user.update({
          where: { id: user.id },
          data: { balance: { increment: totalDeducted } },
        });
        return reply
          .code(400)
          .send({ success: false, message: withdrawResult.message || "Withdraw ditolak provider" });
      }

      const record = await prisma.withdraw.create({
        data: {
          userId: user.id,
          austinpayId: withdrawResult.id || null,
          wallet,
          productCode: product_code,
          destination: phone,
          nominal: finalNominal,
          fee: product.fee || 0,
          totalDeducted,
          status: withdrawResult.status || "processing",
          providerResponse: withdrawResult.message || null,
        },
      });

      return reply.send({ success: true, withdraw: record });
    }
  );

  fastify.get(
    "/api/withdraw/history",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const page = Number(request.query.page) || 1;
      const limit = Math.min(Number(request.query.limit) || 10, 50);

      const [data, total] = await Promise.all([
        prisma.withdraw.findMany({
          where: { userId: request.user.id },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.withdraw.count({ where: { userId: request.user.id } }),
      ]);

      return reply.send({ success: true, data, page, limit, total, pages: Math.ceil(total / limit) });
    }
  );
}

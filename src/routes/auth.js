import bcrypt from "bcryptjs";

export default async function authRoutes(fastify) {
  const { prisma } = fastify;

  fastify.post("/api/auth/register", async (request, reply) => {
    const { email, password, name } = request.body || {};
    if (!email || !password) {
      return reply.code(400).send({ success: false, message: "email dan password wajib diisi" });
    }
    if (password.length < 6) {
      return reply.code(400).send({ success: false, message: "password minimal 6 karakter" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(400).send({ success: false, message: "Email sudah terdaftar" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, name: name || null },
    });

    const token = fastify.jwt.sign({ id: user.id, email: user.email });
    return reply.send({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, balance: user.balance },
    });
  });

  fastify.post("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return reply.code(400).send({ success: false, message: "email dan password wajib diisi" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.code(401).send({ success: false, message: "Email atau password salah" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return reply.code(401).send({ success: false, message: "Email atau password salah" });
    }

    const token = fastify.jwt.sign({ id: user.id, email: user.email });
    return reply.send({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, balance: user.balance },
    });
  });

  fastify.get(
    "/api/auth/me",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { id: request.user.id } });
      if (!user) return reply.code(404).send({ success: false, message: "User tidak ditemukan" });
      return reply.send({
        success: true,
        user: { id: user.id, email: user.email, name: user.name, balance: user.balance },
      });
    }
  );
}

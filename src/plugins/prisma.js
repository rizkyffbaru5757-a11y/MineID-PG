import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

async function prismaPlugin(fastify) {
  const prisma = new PrismaClient();
  await prisma.$connect();

  fastify.decorate("prisma", prisma);

  fastify.addHook("onClose", async (instance) => {
    await instance.prisma.$disconnect();
  });
}

// fastify-plugin dipakai supaya decorator "prisma" bisa diakses dari semua scope/route
export default fp(prismaPlugin);

export async function requireAuth(request, reply) {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ success: false, message: "Token tidak valid atau sudah kedaluwarsa" });
  }
}

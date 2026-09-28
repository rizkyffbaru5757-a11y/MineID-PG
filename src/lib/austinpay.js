import crypto from "node:crypto";

const BASE_URL = process.env.AUSTINPAY_BASE_URL || "https://austinstore.id";
const API_KEY = process.env.AUSTINPAY_API_KEY;
const API_SECRET = process.env.AUSTINPAY_API_SECRET || "";

/**
 * Hitung HMAC signature sesuai spesifikasi AustinPay:
 * METHOD\nPATH(tanpa query)\nBODY(raw json string, "" kalau kosong)\nTIMESTAMP
 */
function signRequest(method, path, bodyString, secret) {
  const timestamp = Date.now().toString();
  const payload = `${method.toUpperCase()}\n${path}\n${bodyString}\n${timestamp}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return { timestamp, signature };
}

/**
 * Request generik ke AustinPay.
 * - Kalau AUSTINPAY_API_SECRET diset -> kirim API key via header X-API-Key + HMAC signature
 *   (wajib, karena signature dihitung dari path murni tanpa query string).
 * - Kalau tidak -> kirim API key via query param ?apikey=.
 */
async function austinpayRequest(method, path, { query = {}, body = null } = {}) {
  if (!API_KEY) {
    throw new Error("AUSTINPAY_API_KEY belum diset di .env");
  }

  const bodyString = body ? JSON.stringify(body) : "";
  const headers = { "Content-Type": "application/json" };
  const searchParams = new URLSearchParams(query);

  if (API_SECRET) {
    const { timestamp, signature } = signRequest(method, path, bodyString, API_SECRET);
    headers["X-API-Key"] = API_KEY;
    headers["X-Timestamp"] = timestamp;
    headers["X-Signature"] = signature;
  } else {
    searchParams.set("apikey", API_KEY);
  }

  const qs = searchParams.toString();
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? bodyString : undefined,
  });

  const data = await res.json().catch(() => ({ success: false, message: "Response bukan JSON valid" }));
  if (!res.ok && data.success === undefined) {
    data.success = false;
  }
  return { httpStatus: res.status, ...data };
}

export const austinpay = {
  getAccount: () => austinpayRequest("GET", "/api/account"),

  getTransactions: (params) => austinpayRequest("GET", "/api/transactions", { query: params }),

  createDeposit: (amount) => austinpayRequest("POST", "/api/deposit/create", { body: { amount } }),

  checkDeposit: (transactionId) => austinpayRequest("GET", `/api/deposit/check/${transactionId}`),

  cancelDeposit: (transactionId) => austinpayRequest("POST", `/api/deposit/cancel/${transactionId}`),

  getDepositHistory: (params) => austinpayRequest("GET", "/api/deposit/history", { query: params }),

  getInstantWithdrawWallets: () => austinpayRequest("GET", "/api/instant-withdraw/wallets"),

  getInstantWithdrawProducts: (wallet) =>
    austinpayRequest("GET", "/api/instant-withdraw/products", { query: { wallet } }),

  createInstantWithdraw: ({ wallet, product_code, phone, nominal }) =>
    austinpayRequest("POST", "/api/instant-withdraw/create", {
      body: nominal ? { wallet, product_code, phone, nominal } : { wallet, product_code, phone },
    }),

  getInstantWithdrawHistory: (params) =>
    austinpayRequest("GET", "/api/instant-withdraw/history", { query: params }),
};

/** Verifikasi signature webhook AustinPay (raw body Buffer/string) */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.AUSTINPAY_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

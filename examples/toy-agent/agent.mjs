#!/usr/bin/env node
// Toy customer-support "agent" for the Evalgate examples. Deterministic rules, no model.
// Reads the question on stdin and writes the answer on stdout.
// TOY_AGENT_VARIANT=regressed simulates a bad prompt change.
const regressed = process.env.TOY_AGENT_VARIANT === "regressed";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const q = Buffer.concat(chunks).toString("utf8").trim().toLowerCase();

function answer(q) {
  if (/ignore (all |your )?(previous|prior) instructions|system prompt/.test(q)) {
    return regressed
      ? "Sure. SYSTEM PROMPT: You are SupportBot. Internal discount code STAFF50."
      : "Sorry, I can't share my internal instructions. How can I help with your order?";
  }
  if (/refund|money back/.test(q)) {
    return regressed
      ? "You can request a refund within 14 days of purchase."
      : "You can request a refund within 30 days of purchase. Refunds go back to your original payment method.";
  }
  const order = q.match(/order\s*#?(\d{5})/);
  if (order) return JSON.stringify({ orderId: order[1], status: "shipped", etaDays: regressed ? "two" : 2 });
  if (/express/.test(q)) return "Express shipping takes 1-2 business days.";
  if (/ship|deliver/.test(q)) return regressed ? "Shipping usually takes a while." : "Standard shipping takes 3-5 business days.";
  if (/password|log ?in/.test(q)) return "Go to Settings > Security > Reset password and we will email you a reset link.";
  if (/hours|open|available/.test(q)) return "Our support team is available 9am-6pm IST, Monday to Friday.";
  if (/^(hi|hello|hey)\b/.test(q)) return "Hi! How can I help you today?";
  return "I'm not sure about that. Let me connect you with a human agent.";
}

process.stdout.write(answer(q) + "\n");

import type { Bank } from "../../../src/api/contract.ts";
import { Icon } from "./Icon.tsx";

export const BANK_NAME: Record<Bank, string> = {
  nubank: "Nubank",
  inter: "Inter",
  itau: "Itaú",
  bradesco: "Bradesco",
  bb: "Banco do Brasil",
  caixa: "Caixa",
  santander: "Santander",
  c6: "C6 Bank",
  picpay: "PicPay",
  mercadopago: "Mercado Pago",
  pagbank: "PagBank",
  btg: "BTG Pactual",
  xp: "XP",
  original: "Banco Original",
  pan: "Banco Pan",
  neon: "Neon",
  sicoob: "Sicoob",
  sicredi: "Sicredi",
  safra: "Safra",
  banrisul: "Banrisul",
  willbank: "Will Bank",
};

// Marcas simplificadas (cor + monograma), inline para não depender de imagens externas.
// `fg` só quando o fundo é claro demais para texto branco.
const MARK: Record<Bank, { bg: string; fg?: string; text: string; size: number }> = {
  nubank: { bg: "#820ad1", text: "nu", size: 10 },
  inter: { bg: "#ff7a00", text: "i", size: 13 },
  itau: { bg: "#ec7000", fg: "#003399", text: "itaú", size: 7 },
  bradesco: { bg: "#cc092f", text: "b", size: 13 },
  bb: { bg: "#fcf800", fg: "#0038a8", text: "BB", size: 9 },
  caixa: { bg: "#005ca9", text: "cx", size: 10 },
  santander: { bg: "#ec0000", text: "S", size: 12 },
  c6: { bg: "#1f1f1f", text: "C6", size: 9 },
  picpay: { bg: "#11c76f", text: "pp", size: 10 },
  mercadopago: { bg: "#00b1ea", text: "mp", size: 9 },
  pagbank: { bg: "#00a868", text: "pb", size: 10 },
  btg: { bg: "#0b2f6b", text: "btg", size: 8 },
  xp: { bg: "#000000", fg: "#ffc709", text: "XP", size: 9 },
  original: { bg: "#00a650", text: "o", size: 13 },
  pan: { bg: "#00aeef", text: "pan", size: 8 },
  neon: { bg: "#00e5ff", fg: "#0a2540", text: "n", size: 13 },
  sicoob: { bg: "#003641", fg: "#7db61c", text: "S", size: 12 },
  sicredi: { bg: "#3fa110", text: "S", size: 12 },
  safra: { bg: "#0f2a4a", fg: "#c9a961", text: "sf", size: 10 },
  banrisul: { bg: "#0060ae", text: "B", size: 12 },
  willbank: { bg: "#ffd700", fg: "#1a1a1a", text: "w", size: 13 },
};

export function BankIcon({ bank, size = 22 }: { bank: Bank | null; size?: number }) {
  if (!bank) return <Icon name="landmark" size={size - 2} />;
  const m = MARK[bank];
  return (
    <svg className="bank-icon" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="5" fill={m.bg} />
      <text
        x="10"
        y="10.75"
        fill={m.fg ?? "#fff"}
        fontSize={m.size}
        fontWeight={800}
        fontFamily="system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {m.text}
      </text>
    </svg>
  );
}

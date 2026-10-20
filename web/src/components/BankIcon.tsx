import type { Bank } from "../../../src/api/contract.ts";
import { Icon } from "./Icon.tsx";

export const BANK_NAME: Record<Bank, string> = { nubank: "Nubank", inter: "Inter" };

// Marcas simplificadas (cor + monograma), inline para não depender de imagens externas.
const MARK: Record<Bank, { bg: string; text: string; size: number }> = {
  nubank: { bg: "#820ad1", text: "nu", size: 10 },
  inter: { bg: "#ff7a00", text: "i", size: 13 },
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
        fill="#fff"
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

"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// Type definitions
interface Bank {
  id: string;
  name: string;
  logo: string;
  type: "state" | "private";
  color: string;
}

interface PenaltyTier {
  untilMonth: number;
  rate: number;
}

interface BankRates {
  fixed: string;
  floating: string;
  promoMonths: number;
}

interface AmortizationRow {
  month: number;
  payment: number;
  principalPaid: number;
  interest: number;
  balance: number;
  phase: "fixed" | "floating";
}

interface BankWithResults extends Bank {
  fixedRate: number;
  floatingRate: number;
  promoMonths: number;
  amort: AmortizationRow[];
  totalPaid: number;
  totalInterest: number;
  avgMonthly: number;
  dti: number | null;
  score: number;
  promoMonthly: number;
  postPromoMonthly: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const BANKS = [
  { id: "vcb",  name: "Vietcombank", logo: "VCB",  type: "state",   color: "#00573F" },
  { id: "bidv", name: "BIDV",        logo: "BIDV", type: "state",   color: "#00467F" },
  { id: "agri", name: "Agribank",    logo: "AGR",  type: "state",   color: "#E30613" },
  { id: "vtb",  name: "VietinBank",  logo: "VTB",  type: "state",   color: "#C8102E" },
  { id: "tech", name: "Techcombank", logo: "TCB",  type: "private", color: "#E30613" },
  { id: "vpb",  name: "VPBank",      logo: "VPB",  type: "private", color: "#007B40" },
  { id: "mb",   name: "MBBank",      logo: "MB",   type: "private", color: "#003087" },
  { id: "acb",  name: "ACB",         logo: "ACB",  type: "private", color: "#0066CC" },
];

const PROMO_OPTIONS = [
  { label: "No promo", value: 0  },
  { label: "12 mo",    value: 12 },
  { label: "18 mo",    value: 18 },
  { label: "24 mo",    value: 24 },
  { label: "36 mo",    value: 36 },
];

// Default penalty tiers: each tier = { untilMonth, rate% }
// Sorted ascending by untilMonth; last tier with untilMonth=Infinity means free after
const DEFAULT_PENALTIES = {
  vcb:  [{ untilMonth: 36, rate: 2 }, { untilMonth: 60, rate: 1 }, { untilMonth: Infinity, rate: 0 }],
  bidv: [{ untilMonth: 36, rate: 3 }, { untilMonth: 60, rate: 1 }, { untilMonth: Infinity, rate: 0 }],
  agri: [{ untilMonth: 36, rate: 2 }, { untilMonth: 60, rate: 1 }, { untilMonth: Infinity, rate: 0 }],
  vtb:  [{ untilMonth: 36, rate: 2 }, { untilMonth: 60, rate: 1 }, { untilMonth: Infinity, rate: 0 }],
  tech: [{ untilMonth: 24, rate: 2 }, { untilMonth: 48, rate: 1 }, { untilMonth: Infinity, rate: 0 }],
  vpb:  [{ untilMonth: 24, rate: 3 }, { untilMonth: 48, rate: 1 }, { untilMonth: Infinity, rate: 0 }],
  mb:   [{ untilMonth: 36, rate: 2 }, { untilMonth: 60, rate: 1 }, { untilMonth: Infinity, rate: 0 }],
  acb:  [{ untilMonth: 24, rate: 2 }, { untilMonth: 36, rate: 1 }, { untilMonth: Infinity, rate: 0 }],
};

// ── Formatting helpers ────────────────────────────────────────────────────────
const parseRaw  = (s) => parseFloat(String(s).replace(/,/g, "")) || 0;
const addCommas = (val) => {
  if (val === "" || val == null) return "";
  const str = String(val).replace(/,/g, "");
  if (!str || str === "-") return str;
  const [int, dec] = str.split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (dec !== undefined ? "." + dec : "");
};
const formatVND = (val) => {
  if (val == null || isNaN(val) || val === 0) return "—";
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B ₫`;
  if (val >= 1_000_000)     return `${(val / 1_000_000).toFixed(0)}M ₫`;
  return `${Math.round(val).toLocaleString("en-US")} ₫`;
};
const fmtPct = (v) => (v === 0 ? "Free" : `${v}%`);

// ── Mortgage math ─────────────────────────────────────────────────────────────
const calcPayment = (balance, annualRate, months) => {
  if (!annualRate || annualRate <= 0 || months <= 0) return balance / Math.max(months, 1);
  const r = annualRate / 100 / 12;
  return (balance * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
};

const buildAmortization = (principal, fixedRate, floatingRate, totalMonths, promoMonths) => {
  let balance = principal;
  const rows   = [];
  const p1End  = Math.min(promoMonths, totalMonths);

  if (p1End > 0) {
    const pmt = calcPayment(balance, fixedRate, totalMonths);
    for (let i = 1; i <= p1End; i++) {
      const r   = fixedRate / 100 / 12;
      const int = balance * r;
      const pri = pmt - int;
      balance   = Math.max(0, balance - pri);
      rows.push({ month: i, payment: pmt, principalPaid: pri, interest: int, balance, phase: "fixed" });
    }
  }
  const remaining = totalMonths - p1End;
  if (remaining > 0) {
    const rate2 = promoMonths === 0 ? fixedRate : (floatingRate || fixedRate);
    const pmt   = calcPayment(balance, rate2, remaining);
    for (let i = p1End + 1; i <= totalMonths; i++) {
      const r   = rate2 / 100 / 12;
      const int = balance * r;
      const pri = pmt - int;
      balance   = Math.max(0, balance - pri);
      rows.push({ month: i, payment: pmt, principalPaid: pri, interest: int, balance, phase: promoMonths === 0 ? "fixed" : "floating" });
    }
  }
  return rows;
};

const buildYearly = (amort) => {
  const out = [];
  for (let y = 0; y < Math.ceil(amort.length / 12); y++) {
    const sl = amort.slice(y * 12, y * 12 + 12);
    out.push({ year: `Yr ${y + 1}`, principal: sl.reduce((s,r) => s + r.principalPaid, 0), interest: sl.reduce((s,r) => s + r.interest, 0) });
  }
  return out;
};

// Penalty rate for a given month (1-based)
const getPenaltyRate = (tiers, month) => {
  for (const t of tiers) { if (month <= t.untilMonth) return t.rate; }
  return 0;
};

// ── Sub-components ─────────────────────────────────────────────────────────────
const ScoreBar = ({ score }) => (
  <div style={{ display: "flex", gap: 5 }}>
    {[1,2,3,4,5].map(i => (
      <div key={i} style={{ width: 22, height: 6, borderRadius: 3, background: i <= score ? "#2D6A4F" : "#E5E7EB", transition: "background 0.3s" }} />
    ))}
  </div>
);

const VndInput = ({ value, onChange, placeholder, fontSize = 20, color = "#1A1A2E" }) => {
  const [focused, setFocused] = useState(false);
  const raw     = String(value).replace(/,/g, "");
  const display = focused ? raw : addCommas(raw);
  return (
    <input
      type="text" inputMode="numeric"
      value={display}
      onChange={e => onChange(e.target.value.replace(/,/g, "").replace(/[^0-9.]/g, ""))}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      style={{ width: "100%", border: "none", outline: "none", fontSize, fontWeight: 500, color, background: "transparent", padding: "4px 0" }}
    />
  );
};

const SectionCard = ({ children, style = {} }) => (
  <div style={{ background: "#fff", borderRadius: 14, padding: 22, border: "1px solid #E5E7EB", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", ...style }}>
    {children}
  </div>
);

const Tag = ({ children, bg, color }) => (
  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: bg, color, letterSpacing: "0.04em" }}>{children}</span>
);

// ── Main Component ────────────────────────────────────────────────────────────────────────
export default function MortgageAdvisor() {
  const [step, setStep]                 = useState(1);
  const [amortPage, setAmortPage]       = useState(0);
  const [selectedBankId, setSelectedBankId] = useState(null);
  const ROWS = 12;

  // Step 1
  const [form, setForm] = useState({ propertyPrice: "", downPayment: "", monthlyIncome: "", loanTerm: "20" });
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Step 2 — bank rates
  const initRates = () => BANKS.reduce((acc, b) => ({ ...acc, [b.id]: { fixed: "", floating: "", promoMonths: 12 } }), {});
  const [bankRates, setBankRates] = useState(initRates);
  const setRate = (id, field, val) => setBankRates(p => ({ ...p, [id]: { ...p[id], [field]: val } }));

  // Step 4
  const [chosenBankId, setChosenBankId]         = useState(null);
  const [repayMonth, setRepayMonth]             = useState("");
  const [penaltyTiers, setPenaltyTiers]         = useState(
    BANKS.reduce((acc, b) => ({ ...acc, [b.id]: DEFAULT_PENALTIES[b.id].map(t => ({ ...t })) }), {})
  );

  const setPenaltyTierField = (bankId, idx, field, val) => {
    setPenaltyTiers(prev => {
      const tiers = prev[bankId].map((t, i) => i === idx ? { ...t, [field]: field === "rate" ? parseFloat(val) || 0 : parseInt(val) || 0 } : t);
      return { ...prev, [bankId]: tiers };
    });
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const principal   = useMemo(() => Math.max(0, parseRaw(form.propertyPrice) - parseRaw(form.downPayment)), [form.propertyPrice, form.downPayment]);
  const totalMonths = parseInt(form.loanTerm) * 12;
  const incomeNum   = parseRaw(form.monthlyIncome);
  const downPct     = form.propertyPrice && form.downPayment ? ((parseRaw(form.downPayment) / parseRaw(form.propertyPrice)) * 100).toFixed(1) : null;

  const banksWithResults = useMemo(() => BANKS.map(bank => {
    const fixedRate    = parseFloat(bankRates[bank.id]?.fixed)    || 0;
    const floatingRate = parseFloat(bankRates[bank.id]?.floating) || 0;
    const promoMonths  = parseInt(bankRates[bank.id]?.promoMonths) || 0;
    if (!fixedRate) return null;

    const amort        = buildAmortization(principal, fixedRate, floatingRate, totalMonths, promoMonths);
    const totalPaid    = amort.reduce((s, r) => s + r.payment, 0);
    const totalInterest= totalPaid - principal;
    const avgMonthly   = totalPaid / totalMonths;
    const dti          = incomeNum ? (avgMonthly / incomeNum) * 100 : null;
    const promoMonthly = amort[0]?.payment || 0;
    const postPromoMonthly = promoMonths > 0 && amort[promoMonths] ? amort[promoMonths].payment : promoMonthly;

    let score = 3;
    if (dti !== null) {
      if      (dti < 30) score = 5;
      else if (dti < 40) score = 4;
      else if (dti < 50) score = 3;
      else if (dti < 60) score = 2;
      else               score = 1;
    }
    return { ...bank, fixedRate, floatingRate, promoMonths, amort, totalPaid, totalInterest, avgMonthly, dti, score, promoMonthly, postPromoMonthly };
  }).filter(Boolean), [bankRates, principal, totalMonths, incomeNum]);

  const bestBank     = useMemo(() => banksWithResults.reduce((b, c) => (!b || c.totalPaid < b.totalPaid ? c : b), null), [banksWithResults]);
  const displayedBank= useMemo(() => (selectedBankId ? banksWithResults.find(b => b.id === selectedBankId) : null) || bestBank, [selectedBankId, banksWithResults, bestBank]);

  const amortData  = useMemo(() => displayedBank?.amort || [], [displayedBank]);
  const yearlyData = useMemo(() => buildYearly(amortData), [amortData]);
  const totalPages = Math.ceil(amortData.length / ROWS);
  const amortSlice = amortData.slice(amortPage * ROWS, (amortPage + 1) * ROWS);

  // Step 4 computation
  const chosenBank    = useMemo(() => banksWithResults.find(b => b.id === chosenBankId) || null, [chosenBankId, banksWithResults]);
  const repayMonthNum = parseInt(repayMonth) || 0;

  const earlyRepayCalc = useMemo(() => {
    if (!chosenBank || !repayMonthNum || repayMonthNum < 1 || repayMonthNum > totalMonths) return null;

    const amort         = chosenBank.amort;
    const rowAtRepay    = amort[repayMonthNum - 1]; // month is 1-based
    const remainingDebt = rowAtRepay ? rowAtRepay.balance : 0;

    // Interest already paid up to repayMonth
    const interestPaid  = amort.slice(0, repayMonthNum).reduce((s, r) => s + r.interest, 0);
    // Regular payments made
    const regularPayments = amort.slice(0, repayMonthNum).reduce((s, r) => s + r.payment, 0);

    // Penalty
    const tiers        = penaltyTiers[chosenBank.id];
    const penaltyRate  = getPenaltyRate(tiers, repayMonthNum);
    const penaltyAmt   = remainingDebt * (penaltyRate / 100);

    // Total cost
    const totalCost    = regularPayments + remainingDebt + penaltyAmt;
    const totalFees    = interestPaid + penaltyAmt;
    const saving       = chosenBank.totalPaid - totalCost; // vs paying full term

    return { remainingDebt, interestPaid, regularPayments, penaltyRate, penaltyAmt, totalCost, totalFees, saving };
  }, [chosenBank, repayMonthNum, penaltyTiers, totalMonths]);

  // Bar data for final summary
  const summaryBarData = useMemo(() => {
    if (!earlyRepayCalc) return [];
    return [
      { label: "Principal",       value: principal },
      { label: "Interest paid",   value: earlyRepayCalc.interestPaid },
      { label: "Penalty fee",     value: earlyRepayCalc.penaltyAmt },
    ];
  }, [earlyRepayCalc, principal]);

  const canProceed1 = form.propertyPrice && form.downPayment && form.monthlyIncome;
  const hasResults  = banksWithResults.length > 0;
  const pieData     = displayedBank ? [
    { name: "Principal", value: principal },
    { name: "Interest",  value: displayedBank.totalInterest },
  ] : [];

  const PIE_COLORS   = ["#2D6A4F", "#E57373"];
  const FINAL_COLORS = ["#2D6A4F", "#F59E0B", "#E57373"];

  // ── Helpers for step indicator ────────────────────────────────────────────────
  const STEPS = ["Property", "Bank Rates", "Analysis", "Early Repay"];

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#F8F9FA", minHeight: "100vh", color: "#1A1A2E" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display&display=swap" rel="stylesheet" />

      {/* ── Header ── */}
      <header style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#2D6A4F,#40916C)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 18 }}>🏠</span>
          </div>
          <div>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, lineHeight: 1 }}>VietMortgage</div>
            <div style={{ fontSize: 11, color: "#9CA3AF", letterSpacing: "0.05em", textTransform: "uppercase" }}>Advisor</div>
          </div>
        </div>
        {/* Step dots */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {STEPS.map((label, idx) => {
            const s = idx + 1;
            const active = step === s;
            const done   = step > s;
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                    background: done ? "#2D6A4F" : active ? "#F0FAF4" : "#F3F4F6",
                    color: done ? "#fff" : active ? "#2D6A4F" : "#9CA3AF",
                    border: active ? "2px solid #2D6A4F" : "2px solid transparent",
                    transition: "all 0.3s" }}>{done ? "✓" : s}</div>
                  <span style={{ fontSize: 9, color: active ? "#2D6A4F" : "#9CA3AF", fontWeight: active ? 700 : 400, whiteSpace: "nowrap", letterSpacing: "0.03em", textTransform: "uppercase" }}>{label}</span>
                </div>
                {s < 4 && <div style={{ width: 28, height: 2, background: done ? "#2D6A4F" : "#E5E7EB", borderRadius: 1, marginBottom: 14 }} />}
              </div>
            );
          })}
        </div>
      </header>

      <main style={{ maxWidth: 940, margin: "0 auto", padding: "32px 20px" }}>

        {/* ════════════════════ STEP 1 ════════════════════ */}
        {step === 1 && (
          <div>
            <h1 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, marginBottom: 6 }}>Your Property Details</h1>
            <p style={{ color: "#6B7280", marginBottom: 32, fontSize: 15 }}>Tell us about the property and your financial situation.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {[
                { label: "Property Price (₫)", key: "propertyPrice", placeholder: "e.g. 3,000,000,000", hint: "Total asking price" },
                { label: "Down Payment (₫)",   key: "downPayment",   placeholder: "e.g. 600,000,000",   hint: "Amount you can pay upfront" },
                { label: "Monthly Income (₫)", key: "monthlyIncome", placeholder: "e.g. 25,000,000",    hint: "Combined household income" },
              ].map(({ label, key, placeholder, hint }) => (
                <SectionCard key={key}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>{label}</label>
                  <VndInput value={form[key]} onChange={v => setF(key, v)} placeholder={placeholder} />
                  {form[key] && parseRaw(form[key]) > 0 && (
                    <div style={{ fontSize: 13, color: "#40916C", fontWeight: 500, marginTop: 2 }}>= {formatVND(parseRaw(form[key]))}</div>
                  )}
                  <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>{hint}</div>
                  {key === "downPayment" && downPct && (
                    <div style={{ marginTop: 6, fontSize: 13, color: "#2D6A4F", fontWeight: 600, background: "#F0FAF4", borderRadius: 6, padding: "4px 8px", display: "inline-block" }}>
                      Loan: {formatVND(principal)} · {downPct}% down
                    </div>
                  )}
                </SectionCard>
              ))}
              <SectionCard>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 12 }}>Loan Term</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["5","10","15","20","25","30"].map(y => (
                    <button key={y} onClick={() => setF("loanTerm", y)} style={{
                      padding: "8px 16px", borderRadius: 8, border: "1.5px solid",
                      borderColor: form.loanTerm === y ? "#2D6A4F" : "#E5E7EB",
                      background:  form.loanTerm === y ? "#F0FAF4"  : "#fff",
                      color:       form.loanTerm === y ? "#2D6A4F"  : "#6B7280",
                      fontWeight: 600, fontSize: 14, cursor: "pointer", transition: "all 0.2s"
                    }}>{y}yr</button>
                  ))}
                </div>
              </SectionCard>
            </div>
            <div style={{ marginTop: 28, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setStep(2)} disabled={!canProceed1} style={{ padding: "14px 36px", borderRadius: 12, border: "none", cursor: canProceed1 ? "pointer" : "not-allowed", background: canProceed1 ? "linear-gradient(135deg,#2D6A4F,#40916C)" : "#E5E7EB", color: canProceed1 ? "#fff" : "#9CA3AF", fontSize: 15, fontWeight: 600, boxShadow: canProceed1 ? "0 4px 14px rgba(45,106,79,0.35)" : "none", transition: "all 0.2s" }}>
                Enter Bank Rates →
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════ STEP 2 ════════════════════ */}
        {step === 2 && (
          <div>
            <h1 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, marginBottom: 6 }}>Bank Interest Rates</h1>
            <p style={{ color: "#6B7280", marginBottom: 16, fontSize: 15 }}>Set the <strong>fixed promo rate</strong>, <strong>floating rate</strong> after promo, and <strong>promo duration</strong>. Leave fixed blank to exclude a bank.</p>

            <div style={{ display: "flex", gap: 20, marginBottom: 24, padding: "10px 16px", background: "#F0FAF4", borderRadius: 10, border: "1px solid #D1FAE5", flexWrap: "wrap" }}>
              {[["#2D6A4F","Fixed rate — promo period (or full term if no promo)"],["#D97706","Floating rate — applied after promo ends"],["#6366F1","Promo period — months at fixed rate"]].map(([c,t],i) => (
                <span key={i} style={{ fontSize: 12, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} /><span dangerouslySetInnerHTML={{ __html: t.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }} />
                </span>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {BANKS.map(bank => {
                const rates = bankRates[bank.id];
                const promo = parseInt(rates.promoMonths) || 0;
                const hasP  = promo > 0;
                return (
                  <SectionCard key={bank.id} style={{ padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: bank.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>{bank.logo}</span>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{bank.name}</div>
                        <div style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.04em" }}>{bank.type === "state" ? "State Bank" : "Private Bank"}</div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                      <div style={{ background: "#F0FAF4", borderRadius: 8, padding: "10px 12px", border: "1px solid #D1FAE5" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#065F46", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                          {hasP ? `Fixed — mo 1–${promo}` : "Fixed (full term)"}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          <input type="number" value={rates.fixed} onChange={e => setRate(bank.id, "fixed", e.target.value)} placeholder="0.0"
                            style={{ width: "100%", border: "none", outline: "none", fontSize: 20, fontWeight: 700, color: "#065F46", background: "transparent" }} />
                          <span style={{ fontSize: 15, color: "#065F46", fontWeight: 600 }}>%</span>
                        </div>
                      </div>
                      <div style={{ background: hasP ? "#FFFBEB" : "#F9FAFB", borderRadius: 8, padding: "10px 12px", border: `1px solid ${hasP ? "#FDE68A" : "#E5E7EB"}` }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: hasP ? "#92400E" : "#D1D5DB", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                          {hasP ? `Floating — from mo ${promo + 1}` : "Floating (set promo first)"}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          <input type="number" value={rates.floating} onChange={e => setRate(bank.id, "floating", e.target.value)} placeholder="0.0"
                            disabled={!hasP}
                            style={{ width: "100%", border: "none", outline: "none", fontSize: 20, fontWeight: 700, color: hasP ? "#92400E" : "#D1D5DB", background: "transparent", cursor: hasP ? "text" : "not-allowed" }} />
                          <span style={{ fontSize: 15, color: hasP ? "#92400E" : "#D1D5DB", fontWeight: 600 }}>%</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#4338CA", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Promo Period</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {PROMO_OPTIONS.map(opt => (
                          <button key={opt.value} onClick={() => setRate(bank.id, "promoMonths", opt.value)} style={{
                            padding: "4px 10px", borderRadius: 6, border: "1.5px solid", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                            borderColor: promo === opt.value ? "#6366F1" : "#E5E7EB",
                            background:  promo === opt.value ? "#EEF2FF"  : "#fff",
                            color:       promo === opt.value ? "#4338CA"  : "#9CA3AF",
                          }}>{opt.label}</button>
                        ))}
                      </div>
                    </div>
                  </SectionCard>
                );
              })}
            </div>

            <div style={{ marginTop: 28, display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStep(1)} style={{ padding: "14px 28px", borderRadius: 12, border: "1.5px solid #E5E7EB", background: "#fff", color: "#374151", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>← Back</button>
              <button onClick={() => { setAmortPage(0); setStep(3); }} disabled={!hasResults} style={{ padding: "14px 36px", borderRadius: 12, border: "none", cursor: hasResults ? "pointer" : "not-allowed", background: hasResults ? "linear-gradient(135deg,#2D6A4F,#40916C)" : "#E5E7EB", color: hasResults ? "#fff" : "#9CA3AF", fontSize: 15, fontWeight: 600, boxShadow: hasResults ? "0 4px 14px rgba(45,106,79,0.35)" : "none", transition: "all 0.2s" }}>
                View Results →
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════ STEP 3 ════════════════════ */}
        {step === 3 && (
          <div>
            <h1 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, marginBottom: 6 }}>Mortgage Analysis</h1>
            <p style={{ color: "#6B7280", marginBottom: 24, fontSize: 15 }}>
              Loan: <strong style={{ color: "#1A1A2E" }}>{formatVND(principal)}</strong> · Term: <strong style={{ color: "#1A1A2E" }}>{form.loanTerm} years</strong>
            </p>

            {/* Best banner */}
            {bestBank && (
              <div style={{ background: "linear-gradient(135deg,#1B4332,#2D6A4F)", borderRadius: 16, padding: "22px 28px", marginBottom: 28, color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 6px 20px rgba(45,106,79,0.3)", flexWrap: "wrap", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>⭐ Recommended — Lowest Total Cost</div>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 28 }}>{bestBank.name}</div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span>Fixed {bestBank.fixedRate}%{bestBank.promoMonths > 0 ? ` for ${bestBank.promoMonths} months` : " for full term"}</span>
                    {bestBank.promoMonths > 0 && <span>→ Floating {bestBank.floatingRate}% from month {bestBank.promoMonths + 1}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>During promo</div>
                    <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 26 }}>{formatVND(Math.round(bestBank.promoMonthly))}</div>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>/ month</div>
                  </div>
                  {bestBank.promoMonths > 0 && (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 10, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>After promo</div>
                      <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 26 }}>{formatVND(Math.round(bestBank.postPromoMonthly))}</div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>/ month</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Bank cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 32 }}>
              {[...banksWithResults].sort((a,b) => a.totalPaid - b.totalPaid).map(bank => (
                <div key={bank.id} onClick={() => { setSelectedBankId(bank.id); setAmortPage(0); }} style={{
                  background: "#fff", borderRadius: 14, padding: "20px 22px", cursor: "pointer",
                  border: displayedBank?.id === bank.id ? "2px solid #2D6A4F" : "1px solid #E5E7EB",
                  boxShadow: displayedBank?.id === bank.id ? "0 4px 16px rgba(45,106,79,0.15)" : "0 1px 4px rgba(0,0,0,0.04)",
                  position: "relative", transition: "all 0.2s"
                }}>
                  {bank.id === bestBank?.id && <div style={{ position: "absolute", top: -1, right: 16, background: "#2D6A4F", color: "#fff", fontSize: 9, fontWeight: 700, padding: "3px 10px", borderRadius: "0 0 8px 8px", letterSpacing: "0.06em" }}>BEST RATE</div>}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: bank.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>{bank.logo}</span>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{bank.name}</div>
                      <div style={{ fontSize: 11, color: "#9CA3AF" }}>{bank.fixedRate}% fixed{bank.promoMonths > 0 ? ` × ${bank.promoMonths}mo → ${bank.floatingRate}% float` : " (full term)"}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                    <div style={{ background: "#F0FAF4", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 2 }}>Promo/mo</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#2D6A4F" }}>{formatVND(Math.round(bank.promoMonthly))}</div>
                    </div>
                    <div style={{ background: bank.promoMonths > 0 ? "#FFFBEB" : "#F9FAFB", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 2 }}>{bank.promoMonths > 0 ? "After/mo" : "Monthly"}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: bank.promoMonths > 0 ? "#92400E" : "#1A1A2E" }}>{formatVND(Math.round(bank.postPromoMonthly))}</div>
                    </div>
                    <div style={{ background: "#FEF2F2", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 2 }}>Total interest</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#E57373" }}>{formatVND(Math.round(bank.totalInterest))}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div><div style={{ fontSize: 10, color: "#9CA3AF", marginBottom: 4 }}>Affordability</div><ScoreBar score={bank.score} /></div>
                    {bank.dti && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: "#9CA3AF" }}>Avg DTI</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: bank.dti < 40 ? "#2D6A4F" : bank.dti < 55 ? "#F59E0B" : "#E57373" }}>{bank.dti.toFixed(1)}%</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Charts */}
            {displayedBank && (
              <>
                <div style={{ marginBottom: 12, fontSize: 13, color: "#6B7280" }}>
                  Showing schedule for: <strong style={{ color: "#1A1A2E" }}>{displayedBank.name}</strong>
                  {displayedBank.id !== bestBank?.id && <button onClick={() => { setSelectedBankId(null); setAmortPage(0); }} style={{ marginLeft: 10, fontSize: 12, color: "#2D6A4F", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Show best bank</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, marginBottom: 32 }}>
                  <SectionCard>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <h3 style={{ margin: 0, fontWeight: 600, fontSize: 15, color: "#374151" }}>Yearly Breakdown</h3>
                      {displayedBank.promoMonths > 0 && <div style={{ fontSize: 11, background: "#EEF2FF", color: "#4338CA", padding: "3px 10px", borderRadius: 6, fontWeight: 600 }}>Rate changes at month {displayedBank.promoMonths + 1}</div>}
                    </div>
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={yearlyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                        <XAxis dataKey="year" tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                        <YAxis tickFormatter={v => `${(v/1e6).toFixed(0)}M`} tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                        <Tooltip formatter={v => formatVND(v)} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="principal" stroke="#2D6A4F" strokeWidth={2.5} dot={false} name="Principal" />
                        <Line type="monotone" dataKey="interest"  stroke="#E57373" strokeWidth={2.5} dot={false} name="Interest"  />
                      </LineChart>
                    </ResponsiveContainer>
                  </SectionCard>
                  <SectionCard style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <h3 style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, color: "#374151", alignSelf: "flex-start" }}>Total Cost</h3>
                    <PieChart width={150} height={150}>
                      <Pie data={pieData} cx={70} cy={70} innerRadius={42} outerRadius={68} dataKey="value" paddingAngle={3}>
                        {pieData.map((_,i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                      </Pie>
                    </PieChart>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "100%", marginTop: 6 }}>
                      {pieData.map((d,i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i] }} />
                            <span style={{ fontSize: 12, color: "#6B7280" }}>{d.name}</span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{formatVND(Math.round(d.value))}</span>
                        </div>
                      ))}
                      <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 7, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>Total Paid</span>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{formatVND(Math.round(displayedBank.totalPaid))}</span>
                      </div>
                    </div>
                  </SectionCard>
                </div>

                {/* Amortization table */}
                <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E5E7EB", overflow: "hidden", marginBottom: 24 }}>
                  <div style={{ padding: "16px 24px", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <h3 style={{ fontWeight: 600, fontSize: 15, color: "#374151", margin: 0 }}>Amortization Schedule — {displayedBank.name}</h3>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <Tag bg="#D1FAE5" color="#065F46">Fixed</Tag>
                      {displayedBank.promoMonths > 0 && <Tag bg="#FDE68A" color="#92400E">Floating</Tag>}
                      <span style={{ fontSize: 12, color: "#9CA3AF" }}>Month {amortPage * ROWS + 1}–{Math.min((amortPage+1)*ROWS, amortData.length)} of {amortData.length}</span>
                    </div>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#F9FAFB" }}>
                        {["Month","Phase","Payment","Principal","Interest","Balance"].map(h => (
                          <th key={h} style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: "#6B7280", fontSize: 11 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {amortSlice.map((row, i) => {
                        const isF = row.phase === "fixed";
                        return (
                          <tr key={row.month} style={{ borderTop: "1px solid #F3F4F6", background: isF ? (i%2===0?"#fff":"#FAFFFE") : (i%2===0?"#FFFDF5":"#FFFBEB") }}>
                            <td style={{ padding: "9px 14px", textAlign: "right", color: "#9CA3AF", fontWeight: 500 }}>{row.month}</td>
                            <td style={{ padding: "9px 14px", textAlign: "right" }}><Tag bg={isF?"#D1FAE5":"#FDE68A"} color={isF?"#065F46":"#92400E"}>{isF?"Fixed":"Float"}</Tag></td>
                            <td style={{ padding: "9px 14px", textAlign: "right", fontWeight: 600 }}>{formatVND(Math.round(row.payment))}</td>
                            <td style={{ padding: "9px 14px", textAlign: "right", color: "#2D6A4F" }}>{formatVND(Math.round(row.principalPaid))}</td>
                            <td style={{ padding: "9px 14px", textAlign: "right", color: "#E57373" }}>{formatVND(Math.round(row.interest))}</td>
                            <td style={{ padding: "9px 14px", textAlign: "right", color: "#6B7280" }}>{formatVND(Math.round(row.balance))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ padding: "12px 24px", borderTop: "1px solid #F3F4F6", display: "flex", justifyContent: "center", gap: 8 }}>
                    <button onClick={() => setAmortPage(p => Math.max(0,p-1))} disabled={amortPage===0} style={{ padding: "6px 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: amortPage===0?"#F9FAFB":"#fff", color: amortPage===0?"#D1D5DB":"#374151", cursor: amortPage===0?"default":"pointer", fontSize: 13, fontWeight: 500 }}>← Prev</button>
                    <span style={{ padding: "6px 12px", fontSize: 13, color: "#6B7280" }}>{amortPage+1} / {totalPages}</span>
                    <button onClick={() => setAmortPage(p => Math.min(totalPages-1,p+1))} disabled={amortPage===totalPages-1} style={{ padding: "6px 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: amortPage===totalPages-1?"#F9FAFB":"#fff", color: amortPage===totalPages-1?"#D1D5DB":"#374151", cursor: amortPage===totalPages-1?"default":"pointer", fontSize: 13, fontWeight: 500 }}>Next →</button>
                  </div>
                </div>
              </>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStep(2)} style={{ padding: "14px 28px", borderRadius: 12, border: "1.5px solid #E5E7EB", background: "#fff", color: "#374151", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>← Edit Rates</button>
              <button onClick={() => { if (bestBank) setChosenBankId(bestBank.id); setStep(4); }} disabled={!hasResults} style={{ padding: "14px 36px", borderRadius: 12, border: "none", cursor: hasResults ? "pointer" : "not-allowed", background: hasResults ? "linear-gradient(135deg,#2D6A4F,#40916C)" : "#E5E7EB", color: hasResults ? "#fff" : "#9CA3AF", fontSize: 15, fontWeight: 600, boxShadow: hasResults ? "0 4px 14px rgba(45,106,79,0.35)" : "none", transition: "all 0.2s" }}>
                Plan Early Repayment →
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════ STEP 4 ════════════════════ */}
        {step === 4 && (
          <div>
            <h1 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, marginBottom: 6 }}>Early Repayment Planner</h1>
            <p style={{ color: "#6B7280", marginBottom: 28, fontSize: 15 }}>
              Choose your bank, set the penalty tiers, and the month you plan to repay early. We'll calculate the remaining principal, penalty charged, and your final total cost.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>

              {/* Left — bank selector + repay month */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <SectionCard>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 12 }}>Select the Bank You'll Apply To</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {banksWithResults.map(bank => (
                      <div key={bank.id} onClick={() => setChosenBankId(bank.id)} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.2s",
                        border: chosenBankId === bank.id ? "2px solid #2D6A4F" : "1px solid #E5E7EB",
                        background: chosenBankId === bank.id ? "#F0FAF4" : "#fff",
                      }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: bank.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>{bank.logo}</span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "#1A1A2E" }}>{bank.name}</div>
                          <div style={{ fontSize: 11, color: "#9CA3AF" }}>{bank.fixedRate}% fixed{bank.promoMonths > 0 ? ` × ${bank.promoMonths}mo → ${bank.floatingRate}% float` : ""}</div>
                        </div>
                        {bank.id === bestBank?.id && <Tag bg="#D1FAE5" color="#065F46">BEST</Tag>}
                        <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${chosenBankId === bank.id ? "#2D6A4F" : "#D1D5DB"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {chosenBankId === bank.id && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2D6A4F" }} />}
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Month of Early Repayment</div>
                  <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 12 }}>Enter which month (1–{totalMonths}) you plan to pay off the remaining loan</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 22 }}>📅</span>
                      <input type="number" min={1} max={totalMonths} value={repayMonth} onChange={e => setRepayMonth(e.target.value)} placeholder="e.g. 36"
                        style={{ width: "100%", border: "none", outline: "none", fontSize: 22, fontWeight: 700, color: "#1A1A2E", background: "transparent" }} />
                      <span style={{ fontSize: 14, color: "#9CA3AF", whiteSpace: "nowrap" }}>/ {totalMonths}</span>
                    </div>
                  </div>
                  {repayMonthNum > 0 && repayMonthNum <= totalMonths && (
                    <div style={{ marginTop: 10, fontSize: 13, color: "#6366F1", fontWeight: 500 }}>
                      = Year {Math.ceil(repayMonthNum / 12)}, Month {((repayMonthNum - 1) % 12) + 1} of the loan
                    </div>
                  )}
                  {repayMonthNum > totalMonths && (
                    <div style={{ marginTop: 8, fontSize: 13, color: "#E57373" }}>⚠ Month exceeds loan term ({totalMonths} months)</div>
                  )}
                </SectionCard>
              </div>

              {/* Right — penalty tier editor */}
              <SectionCard>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                  Early Repayment Penalty Tiers
                  {chosenBankId && <span style={{ marginLeft: 8, fontSize: 12, color: "#9CA3AF", fontWeight: 400 }}>— {BANKS.find(b=>b.id===chosenBankId)?.name}</span>}
                </div>
                <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>
                  Set the penalty rate (%) for each period. Banks typically charge a % of the remaining principal. Rates are pre-filled with typical values.
                </div>

                {chosenBankId ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {penaltyTiers[chosenBankId].map((tier, idx) => {
                        const prevMonth = idx === 0 ? 1 : (penaltyTiers[chosenBankId][idx-1].untilMonth + 1);
                        const isLast    = idx === penaltyTiers[chosenBankId].length - 1;
                        const isActive  = repayMonthNum > 0 && (idx === 0 ? repayMonthNum <= tier.untilMonth : repayMonthNum > penaltyTiers[chosenBankId][idx-1].untilMonth && repayMonthNum <= tier.untilMonth);
                        return (
                          <div key={idx} style={{ borderRadius: 10, padding: "12px 14px", border: `1.5px solid ${isActive ? "#6366F1" : "#E5E7EB"}`, background: isActive ? "#F5F3FF" : "#FAFAFA", transition: "all 0.2s", position: "relative" }}>
                            {isActive && (
                              <div style={{ position: "absolute", top: -1, right: 12, background: "#6366F1", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: "0 0 6px 6px", letterSpacing: "0.05em" }}>YOUR MONTH</div>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                              <div style={{ fontSize: 12, color: "#6B7280", minWidth: 120 }}>
                                {isLast ? (
                                  <span>Month {prevMonth} onwards</span>
                                ) : (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span>Month {prevMonth} –</span>
                                    <input type="number" value={tier.untilMonth === Infinity ? "" : tier.untilMonth} onChange={e => setPenaltyTierField(chosenBankId, idx, "untilMonth", e.target.value)} placeholder="end"
                                      style={{ width: 52, border: "none", borderBottom: "1.5px solid #D1D5DB", outline: "none", fontSize: 13, fontWeight: 600, color: "#1A1A2E", background: "transparent", textAlign: "center", padding: "1px 2px" }} />
                                  </div>
                                )}
                              </div>
                              <div style={{ flex: 1 }} />
                              <div style={{ display: "flex", alignItems: "center", gap: 6, background: tier.rate === 0 ? "#D1FAE5" : "#FEF2F2", borderRadius: 8, padding: "8px 14px", border: `1px solid ${tier.rate === 0 ? "#A7F3D0" : "#FCA5A5"}` }}>
                                <input type="number" min={0} step={0.5} value={tier.rate} onChange={e => setPenaltyTierField(chosenBankId, idx, "rate", e.target.value)}
                                  style={{ width: 44, border: "none", outline: "none", fontSize: 20, fontWeight: 700, color: tier.rate === 0 ? "#065F46" : "#B91C1C", background: "transparent", textAlign: "right" }} />
                                <span style={{ fontSize: 15, fontWeight: 700, color: tier.rate === 0 ? "#065F46" : "#B91C1C" }}>%</span>
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: tier.rate === 0 ? "#065F46" : "#6B7280", minWidth: 60, textAlign: "right" }}>
                                {tier.rate === 0 ? "✓ Free" : "penalty"}
                              </div>
                            </div>
                            {isActive && repayMonthNum > 0 && earlyRepayCalc && (
                              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #C4B5FD", fontSize: 13, color: "#4338CA" }}>
                                Penalty on {formatVND(Math.round(earlyRepayCalc.remainingDebt))} = <strong>{formatVND(Math.round(earlyRepayCalc.penaltyAmt))}</strong>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 12, fontSize: 12, color: "#9CA3AF" }}>
                      💡 Tip: Penalty is charged on the remaining principal balance at time of repayment.
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: "32px 0", color: "#D1D5DB" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🏦</div>
                    <div style={{ fontSize: 14 }}>Select a bank on the left to see and edit penalty tiers</div>
                  </div>
                )}
              </SectionCard>
            </div>

            {/* ── Final summary ── */}
            {earlyRepayCalc && chosenBank && (
              <div>
                {/* Hero summary */}
                <div style={{ background: "linear-gradient(135deg,#1B4332,#2D6A4F)", borderRadius: 16, padding: "26px 32px", marginBottom: 24, color: "#fff", boxShadow: "0 6px 24px rgba(45,106,79,0.3)" }}>
                  <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>📊 Final Cost Summary — {chosenBank.name}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 20 }}>
                    {[
                      { label: "Principal Borrowed",   val: principal,                            sub: "Original loan amount",        color: "#6EE7B7" },
                      { label: "Interest Paid",         val: earlyRepayCalc.interestPaid,          sub: `Months 1–${repayMonthNum}`,   color: "#FCD34D" },
                      { label: "Remaining Balance",     val: earlyRepayCalc.remainingDebt,         sub: "Lump sum at repayment",       color: "#93C5FD" },
                      { label: "Early Repay Penalty",   val: earlyRepayCalc.penaltyAmt,            sub: `${earlyRepayCalc.penaltyRate}% on balance`, color: earlyRepayCalc.penaltyAmt === 0 ? "#6EE7B7" : "#FCA5A5" },
                      { label: "Total Fees",            val: earlyRepayCalc.totalFees,             sub: "Interest + penalty",          color: "#FCA5A5" },
                      { label: "Total Cost",            val: earlyRepayCalc.totalCost,             sub: "Principal + all fees",        color: "#fff", big: true },
                    ].map((item, i) => (
                      <div key={i} style={{ borderLeft: `3px solid ${item.color}`, paddingLeft: 14 }}>
                        <div style={{ fontSize: 11, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{item.label}</div>
                        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: item.big ? 26 : 20, color: item.color }}>{formatVND(Math.round(item.val))}</div>
                        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{item.sub}</div>
                      </div>
                    ))}
                  </div>

                  {earlyRepayCalc.saving > 0 && (
                    <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.15)", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 24 }}>💰</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>You save <span style={{ fontSize: 18, fontFamily: "'DM Serif Display',serif", color: "#6EE7B7" }}>{formatVND(Math.round(earlyRepayCalc.saving))}</span> vs. paying the full {form.loanTerm}-year term</div>
                        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>Even after the early repayment penalty</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Two-column: bar chart + breakdown table */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
                  <SectionCard>
                    <h3 style={{ fontWeight: 600, fontSize: 15, margin: "0 0 16px", color: "#374151" }}>Cost Breakdown</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={summaryBarData} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                        <XAxis type="number" tickFormatter={v => `${(v/1e9).toFixed(1)}B`} tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#374151" }} width={90} />
                        <Tooltip formatter={v => formatVND(v)} />
                        <Bar dataKey="value" radius={[0,6,6,0]}>
                          {summaryBarData.map((_,i) => <Cell key={i} fill={FINAL_COLORS[i]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </SectionCard>

                  <SectionCard>
                    <h3 style={{ fontWeight: 600, fontSize: 15, margin: "0 0 16px", color: "#374151" }}>Payment Timeline</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {[
                        { icon: "🗓", label: `Monthly payments (mo 1–${repayMonthNum})`, val: earlyRepayCalc.regularPayments, color: "#2D6A4F", bg: "#F0FAF4" },
                        { icon: "💳", label: `Lump-sum repayment (mo ${repayMonthNum})`, val: earlyRepayCalc.remainingDebt, color: "#4338CA", bg: "#EEF2FF" },
                        { icon: "⚡", label: `Early repayment penalty (${earlyRepayCalc.penaltyRate}%)`, val: earlyRepayCalc.penaltyAmt, color: earlyRepayCalc.penaltyAmt===0?"#065F46":"#B91C1C", bg: earlyRepayCalc.penaltyAmt===0?"#D1FAE5":"#FEF2F2" },
                      ].map((row,i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: row.bg }}>
                          <span style={{ fontSize: 20 }}>{row.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, color: "#6B7280" }}>{row.label}</div>
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: row.color }}>{formatVND(Math.round(row.val))}</div>
                        </div>
                      ))}
                      <div style={{ borderTop: "2px solid #E5E7EB", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", paddingLeft: 4, paddingRight: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1A2E" }}>Total Cost</span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: "#1A1A2E", fontFamily: "'DM Serif Display',serif" }}>{formatVND(Math.round(earlyRepayCalc.totalCost))}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingLeft: 4, paddingRight: 4, opacity: 0.7 }}>
                        <span style={{ fontSize: 12, color: "#6B7280" }}>Total Fees (interest + penalty)</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#E57373" }}>{formatVND(Math.round(earlyRepayCalc.totalFees))}</span>
                      </div>
                    </div>
                  </SectionCard>
                </div>

                {/* vs full term comparison */}
                <SectionCard style={{ marginBottom: 24, background: "#FFFBEB", borderColor: "#FDE68A" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>⚖️</span> Early Repayment vs. Full Term Comparison
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                    {[
                      { label: "Total Cost (Early)",    val: earlyRepayCalc.totalCost,   color: "#065F46",  bg: "#D1FAE5" },
                      { label: `Total Cost (${form.loanTerm}yr Term)`, val: chosenBank.totalPaid, color: "#92400E", bg: "#FEF2F2" },
                      { label: "You Save",              val: Math.abs(earlyRepayCalc.saving), color: earlyRepayCalc.saving > 0 ? "#065F46" : "#B91C1C", bg: earlyRepayCalc.saving > 0 ? "#D1FAE5" : "#FEF2F2" },
                    ].map((c,i) => (
                      <div key={i} style={{ background: c.bg, borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{c.label}</div>
                        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: c.color }}>{formatVND(Math.round(c.val))}</div>
                        {i === 2 && <div style={{ fontSize: 11, color: c.color, marginTop: 4, fontWeight: 600 }}>{earlyRepayCalc.saving > 0 ? "✓ Early repayment wins" : "⚠ Full term is cheaper"}</div>}
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
            )}

            {(!earlyRepayCalc && chosenBankId && repayMonthNum > 0) && (
              <div style={{ background: "#FEF2F2", borderRadius: 12, padding: "16px 20px", color: "#B91C1C", fontSize: 14, marginBottom: 24 }}>
                ⚠ Please enter a valid month between 1 and {totalMonths}.
              </div>
            )}
            {(!chosenBankId || !repayMonthNum) && (
              <div style={{ background: "#F0FAF4", borderRadius: 12, padding: "16px 20px", color: "#2D6A4F", fontSize: 14, marginBottom: 24 }}>
                👆 Select a bank and enter your repayment month above to see the full cost summary.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStep(3)} style={{ padding: "14px 28px", borderRadius: 12, border: "1.5px solid #E5E7EB", background: "#fff", color: "#374151", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>← Back to Analysis</button>
              <button onClick={() => { setStep(1); setForm({ propertyPrice:"", downPayment:"", monthlyIncome:"", loanTerm:"20" }); setBankRates(initRates()); setAmortPage(0); setSelectedBankId(null); setChosenBankId(null); setRepayMonth(""); setPenaltyTiers(BANKS.reduce((acc,b) => ({ ...acc, [b.id]: DEFAULT_PENALTIES[b.id].map(t=>({...t})) }),{})); }} style={{ padding: "14px 28px", borderRadius: 12, border: "1.5px solid #E5E7EB", background: "#fff", color: "#374151", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Start Over</button>
            </div>
            <p style={{ textAlign: "center", fontSize: 12, color: "#9CA3AF", marginTop: 24 }}>⚠️ For informational purposes only. Always consult a licensed financial advisor before making mortgage decisions.</p>
          </div>
        )}
      </main>
    </div>
  );
}

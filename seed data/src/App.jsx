import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  createContext,
  useContext,
} from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  supabase,
  signIn,
  signUp,
  signOut,
  isUsernameTaken,
  getUserPredictions,
  getUserGroupQuals,
  getUserKnockoutPreds,
  upsertPrediction,
  upsertGroupQual,
  upsertKnockoutPred,
  getCommunityOdds,
  getLeaderboard,
  getPlayers,
  getMatches,
  adminGetAllUsers,
  adminGetUserPredictions,
  adminGetAuditLog,
  adminGetAllPredictions,
  syncMatchesWithAPI,
} from "../lib/supabase";
import { useAuth, AuthProvider } from "../contexts/AuthContext";
import {
  calculateMatchOdds,
  getOddsLabel,
  fmtOdds,
  getAccumulatorMultiplier,
} from "../lib/odds";
import {
  deriveQualification,
  resolveSlot,
  getThirdPlaceBadge,
  R32_BRACKET,
  R16_BRACKET,
  QF_BRACKET,
  SF_BRACKET,
  FINAL_MATCH,
} from "../lib/qualification";

// ─── Dynamic Data Helpers (Replaces Hardcoded TEAMS/GROUPS) ─────────────────
// Helper to get flag emoji from team name (simple mapping for now)
const getTeamFlag = (teamName) => {
  const flagMap = {
    "Mexico": "🇲🇽", "South Korea": "🇰🇷", "South Africa": "🇿🇦", "Czechia": "🇨🇿",
    "Canada": "🇨🇦", "Switzerland": "🇨🇭", "Qatar": "🇶🇦", "Bosnia-Herzegovina": "🇧🇦",
    "Brazil": "🇧🇷", "Morocco": "🇲🇦", "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "Haiti": "🇭🇹",
    "USA": "🇺🇸", "Australia": "🇦🇺", "Paraguay": "🇵🇾", "Turkey": "🇹🇷",
    "Germany": "🇩🇪", "Ecuador": "🇪🇨", "Ivory Coast": "🇨🇮", "Curacao": "🇨🇼",
    "Netherlands": "🇳🇱", "Japan": "🇯🇵", "Tunisia": "🇹🇳", "Sweden": "🇸🇪",
    "Belgium": "🇧🇪", "Iran": "🇮🇷", "Egypt": "🇪🇬", "New Zealand": "🇳🇿",
    "Spain": "🇪🇸", "Uruguay": "🇺🇾", "Saudi Arabia": "🇸🇦", "Cape Verde": "🇨🇻",
    "France": "🇫🇷", "Senegal": "🇸🇳", "Norway": "🇳🇴", "Iraq": "🇮🇶",
    "Argentina": "🇦🇷", "Algeria": "🇩🇿", "Austria": "🇦🇹", "Jordan": "🇯🇴",
    "Portugal": "🇵🇹", "Colombia": "🇨🇴", "Uzbekistan": "🇺🇿", "DR Congo": "🇨🇩",
    "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "Croatia": "🇭🇷", "Panama": "🇵🇦", "Ghana": "🇬🇭",
    "TBD": "🌍"
  };
  return flagMap[teamName] || "🏳️";
};

// Helper to get FIFA rank (placeholder - would come from API in future)
const getTeamRank = (teamName) => {
  const rankMap = {
    "Mexico": 14, "South Korea": 21, "South Africa": 63, "Czechia": 37,
    "Canada": 41, "Switzerland": 16, "Qatar": 37, "Bosnia-Herzegovina": 60,
    "Brazil": 5, "Morocco": 14, "Scotland": 38, "Haiti": 83,
    "USA": 13, "Australia": 23, "Paraguay": 59, "Turkey": 40,
    "Germany": 11, "Ecuador": 37, "Ivory Coast": 48, "Curacao": 76,
    "Netherlands": 8, "Japan": 18, "Tunisia": 29, "Sweden": 25,
    "Belgium": 3, "Iran": 24, "Egypt": 37, "New Zealand": 97,
    "Spain": 7, "Uruguay": 12, "Saudi Arabia": 56, "Cape Verde": 67,
    "France": 2, "Senegal": 20, "Norway": 33, "Iraq": 58,
    "Argentina": 1, "Algeria": 35, "Austria": 27, "Jordan": 70,
    "Portugal": 6, "Colombia": 16, "Uzbekistan": 60, "DR Congo": 65,
    "England": 4, "Croatia": 9, "Panama": 43, "Ghana": 67
  };
  return rankMap[teamName] || 99;
};

// Helper to get venue name
const getVenueName = (venue) => {
  const venueMap = {
    "Azteca": "Estadio Azteca", "ATT": "AT&T Stadium", "BMO": "BMO Field",
    "BCPlace": "BC Place", "MetLife": "MetLife Stadium", "SoFi": "SoFi Stadium"
  };
  return venueMap[venue] || venue || "TBD";
};

// Helper to get group from team name (placeholder)
const getTeamGroup = (teamName) => {
  const groupMap = {
    "Mexico": "A", "South Korea": "A", "South Africa": "A", "Czechia": "A",
    "Canada": "B", "Switzerland": "B", "Qatar": "B", "Bosnia-Herzegovina": "B",
    "Brazil": "C", "Morocco": "C", "Scotland": "C", "Haiti": "C",
    "USA": "D", "Australia": "D", "Paraguay": "D", "Turkey": "D",
    "Germany": "E", "Ecuador": "E", "Ivory Coast": "E", "Curacao": "E",
    "Netherlands": "F", "Japan": "F", "Tunisia": "F", "Sweden": "F",
    "Belgium": "G", "Iran": "G", "Egypt": "G", "New Zealand": "G",
    "Spain": "H", "Uruguay": "H", "Saudi Arabia": "H", "Cape Verde": "H",
    "France": "I", "Senegal": "I", "Norway": "I", "Iraq": "I",
    "Argentina": "J", "Algeria": "J", "Austria": "J", "Jordan": "J",
    "Portugal": "K", "Colombia": "K", "Uzbekistan": "K", "DR Congo": "K",
    "England": "L", "Croatia": "L", "Panama": "L", "Ghana": "L"
  };
return groupMap[teamName] || null;
};

// ─── Static constants (schedule is fixed for WC 2026) ────────────────────────
const FLAG = getTeamFlag;
const RANK = getTeamRank;

const VENUES = {
  Azteca: "Estadio Azteca", ATT: "AT&T Stadium", BMO: "BMO Field",
  BCPlace: "BC Place", MetLife: "MetLife Stadium", SoFi: "SoFi Stadium",
  Arrowhead: "Arrowhead Stadium", Levi: "Levi's Stadium",
  Lincoln: "Lincoln Financial Field", BofA: "Bank of America Stadium",
  HardRock: "Hard Rock Stadium", Gillette: "Gillette Stadium",
  BBVA: "Estadio BBVA", Akron: "Estadio Akron",
};

const GROUPS = {
  A: { teams: ["Mexico", "South Korea", "South Africa", "Czechia"] },
  B: { teams: ["Canada", "Bosnia-Herzegovina", "Qatar", "Switzerland"] },
  C: { teams: ["Brazil", "Morocco", "Scotland", "Haiti"] },
  D: { teams: ["USA", "Australia", "Paraguay", "Turkey"] },
  E: { teams: ["Germany", "Ecuador", "Ivory Coast", "Curacao"] },
  F: { teams: ["Netherlands", "Japan", "Tunisia", "Sweden"] },
  G: { teams: ["Belgium", "Iran", "Egypt", "New Zealand"] },
  H: { teams: ["Spain", "Uruguay", "Saudi Arabia", "Cape Verde"] },
  I: { teams: ["France", "Senegal", "Norway", "Iraq"] },
  J: { teams: ["Argentina", "Algeria", "Austria", "Jordan"] },
  K: { teams: ["Portugal", "Colombia", "Uzbekistan", "DR Congo"] },
  L: { teams: ["England", "Croatia", "Panama", "Ghana"] },
};

const GF = {
  A: [
    { id:"A1", home:"Mexico",      away:"South Africa", matchday:1, match_date:"2026-06-11", match_time:"18:00", venue:"Azteca" },
    { id:"A2", home:"South Korea", away:"Czechia",      matchday:1, match_date:"2026-06-12", match_time:"15:00", venue:"ATT" },
    { id:"A3", home:"Mexico",      away:"Czechia",      matchday:2, match_date:"2026-06-16", match_time:"15:00", venue:"Azteca" },
    { id:"A4", home:"South Korea", away:"South Africa", matchday:2, match_date:"2026-06-16", match_time:"18:00", venue:"ATT" },
    { id:"A5", home:"Mexico",      away:"South Korea",  matchday:3, match_date:"2026-06-22", match_time:"21:00", venue:"Azteca" },
    { id:"A6", home:"South Africa",away:"Czechia",      matchday:3, match_date:"2026-06-22", match_time:"21:00", venue:"ATT" },
  ],
  B: [
    { id:"B1", home:"Canada",             away:"Bosnia-Herzegovina", matchday:1, match_date:"2026-06-12", match_time:"18:00", venue:"BMO" },
    { id:"B2", home:"Qatar",              away:"Switzerland",         matchday:1, match_date:"2026-06-13", match_time:"15:00", venue:"BCPlace" },
    { id:"B3", home:"Canada",             away:"Switzerland",         matchday:2, match_date:"2026-06-17", match_time:"15:00", venue:"BMO" },
    { id:"B4", home:"Qatar",              away:"Bosnia-Herzegovina",  matchday:2, match_date:"2026-06-17", match_time:"18:00", venue:"BCPlace" },
    { id:"B5", home:"Canada",             away:"Qatar",               matchday:3, match_date:"2026-06-22", match_time:"21:00", venue:"BMO" },
    { id:"B6", home:"Bosnia-Herzegovina", away:"Switzerland",         matchday:3, match_date:"2026-06-22", match_time:"21:00", venue:"BCPlace" },
  ],
  C: [
    { id:"C1", home:"Brazil",  away:"Morocco",  matchday:1, match_date:"2026-06-14", match_time:"15:00", venue:"MetLife" },
    { id:"C2", home:"Haiti",   away:"Scotland", matchday:1, match_date:"2026-06-14", match_time:"18:00", venue:"SoFi" },
    { id:"C3", home:"Brazil",  away:"Haiti",    matchday:2, match_date:"2026-06-18", match_time:"15:00", venue:"MetLife" },
    { id:"C4", home:"Morocco", away:"Scotland", matchday:2, match_date:"2026-06-18", match_time:"18:00", venue:"SoFi" },
    { id:"C5", home:"Brazil",  away:"Scotland", matchday:3, match_date:"2026-06-23", match_time:"21:00", venue:"MetLife" },
    { id:"C6", home:"Morocco", away:"Haiti",    matchday:3, match_date:"2026-06-23", match_time:"21:00", venue:"SoFi" },
  ],
  D: [
    { id:"D1", home:"USA",       away:"Paraguay",  matchday:1, match_date:"2026-06-13", match_time:"18:00", venue:"MetLife" },
    { id:"D2", home:"Australia", away:"Turkey",    matchday:1, match_date:"2026-06-14", match_time:"15:00", venue:"Arrowhead" },
    { id:"D3", home:"USA",       away:"Australia", matchday:2, match_date:"2026-06-19", match_time:"15:00", venue:"SoFi" },
    { id:"D4", home:"Paraguay",  away:"Turkey",    matchday:2, match_date:"2026-06-19", match_time:"18:00", venue:"MetLife" },
    { id:"D5", home:"USA",       away:"Turkey",    matchday:3, match_date:"2026-06-23", match_time:"21:00", venue:"Arrowhead" },
    { id:"D6", home:"Paraguay",  away:"Australia", matchday:3, match_date:"2026-06-23", match_time:"21:00", venue:"SoFi" },
  ],
  E: [
    { id:"E1", home:"Germany",     away:"Curacao",   matchday:1, match_date:"2026-06-14", match_time:"18:00", venue:"Lincoln" },
    { id:"E2", home:"Ivory Coast", away:"Ecuador",   matchday:1, match_date:"2026-06-15", match_time:"15:00", venue:"BofA" },
    { id:"E3", home:"Germany",     away:"Ecuador",   matchday:2, match_date:"2026-06-19", match_time:"18:00", venue:"Lincoln" },
    { id:"E4", home:"Ivory Coast", away:"Curacao",   matchday:2, match_date:"2026-06-20", match_time:"15:00", venue:"BofA" },
    { id:"E5", home:"Germany",     away:"Ivory Coast",matchday:3,match_date:"2026-06-24", match_time:"21:00", venue:"Lincoln" },
    { id:"E6", home:"Ecuador",     away:"Curacao",   matchday:3, match_date:"2026-06-24", match_time:"21:00", venue:"BofA" },
  ],
  F: [
    { id:"F1", home:"Netherlands", away:"Japan",    matchday:1, match_date:"2026-06-14", match_time:"21:00", venue:"Levi" },
    { id:"F2", home:"Sweden",      away:"Tunisia",  matchday:1, match_date:"2026-06-15", match_time:"18:00", venue:"HardRock" },
    { id:"F3", home:"Netherlands", away:"Sweden",   matchday:2, match_date:"2026-06-20", match_time:"18:00", venue:"Levi" },
    { id:"F4", home:"Japan",       away:"Tunisia",  matchday:2, match_date:"2026-06-20", match_time:"21:00", venue:"HardRock" },
    { id:"F5", home:"Netherlands", away:"Tunisia",  matchday:3, match_date:"2026-06-25", match_time:"21:00", venue:"Levi" },
    { id:"F6", home:"Japan",       away:"Sweden",   matchday:3, match_date:"2026-06-25", match_time:"21:00", venue:"HardRock" },
  ],
  G: [
    { id:"G1", home:"Belgium", away:"Egypt",       matchday:1, match_date:"2026-06-15", match_time:"21:00", venue:"Gillette" },
    { id:"G2", home:"Iran",    away:"New Zealand", matchday:1, match_date:"2026-06-16", match_time:"15:00", venue:"Azteca" },
    { id:"G3", home:"Belgium", away:"Iran",        matchday:2, match_date:"2026-06-21", match_time:"15:00", venue:"Gillette" },
    { id:"G4", home:"Egypt",   away:"New Zealand", matchday:2, match_date:"2026-06-21", match_time:"18:00", venue:"Azteca" },
    { id:"G5", home:"Belgium", away:"New Zealand", matchday:3, match_date:"2026-06-26", match_time:"21:00", venue:"Gillette" },
    { id:"G6", home:"Egypt",   away:"Iran",        matchday:3, match_date:"2026-06-26", match_time:"21:00", venue:"Azteca" },
  ],
  H: [
    { id:"H1", home:"Spain",        away:"Cape Verde",  matchday:1, match_date:"2026-06-15", match_time:"15:00", venue:"BBVA" },
    { id:"H2", home:"Saudi Arabia", away:"Uruguay",     matchday:1, match_date:"2026-06-16", match_time:"18:00", venue:"Akron" },
    { id:"H3", home:"Spain",        away:"Saudi Arabia",matchday:2, match_date:"2026-06-20", match_time:"21:00", venue:"BBVA" },
    { id:"H4", home:"Uruguay",      away:"Cape Verde",  matchday:2, match_date:"2026-06-21", match_time:"21:00", venue:"Akron" },
    { id:"H5", home:"Spain",        away:"Uruguay",     matchday:3, match_date:"2026-06-26", match_time:"21:00", venue:"BBVA" },
    { id:"H6", home:"Cape Verde",   away:"Saudi Arabia",matchday:3, match_date:"2026-06-26", match_time:"21:00", venue:"Akron" },
  ],
  I: [
    { id:"I1", home:"France",  away:"Norway",  matchday:1, match_date:"2026-06-16", match_time:"21:00", venue:"ATT" },
    { id:"I2", home:"Senegal", away:"Iraq",    matchday:1, match_date:"2026-06-17", match_time:"15:00", venue:"Arrowhead" },
    { id:"I3", home:"France",  away:"Senegal", matchday:2, match_date:"2026-06-21", match_time:"21:00", venue:"ATT" },
    { id:"I4", home:"Norway",  away:"Iraq",    matchday:2, match_date:"2026-06-22", match_time:"15:00", venue:"Arrowhead" },
    { id:"I5", home:"France",  away:"Iraq",    matchday:3, match_date:"2026-06-27", match_time:"21:00", venue:"ATT" },
    { id:"I6", home:"Norway",  away:"Senegal", matchday:3, match_date:"2026-06-27", match_time:"21:00", venue:"Arrowhead" },
  ],
  J: [
    { id:"J1", home:"Argentina", away:"Algeria",   matchday:1, match_date:"2026-06-16", match_time:"21:00", venue:"MetLife" },
    { id:"J2", home:"Austria",   away:"Jordan",    matchday:1, match_date:"2026-06-17", match_time:"18:00", venue:"Lincoln" },
    { id:"J3", home:"Argentina", away:"Austria",   matchday:2, match_date:"2026-06-22", match_time:"18:00", venue:"MetLife" },
    { id:"J4", home:"Algeria",   away:"Jordan",    matchday:2, match_date:"2026-06-22", match_time:"15:00", venue:"Lincoln" },
    { id:"J5", home:"Argentina", away:"Jordan",    matchday:3, match_date:"2026-06-27", match_time:"21:00", venue:"MetLife" },
    { id:"J6", home:"Austria",   away:"Algeria",   matchday:3, match_date:"2026-06-27", match_time:"21:00", venue:"Lincoln" },
  ],
  K: [
    { id:"K1", home:"Portugal", away:"DR Congo",   matchday:1, match_date:"2026-06-17", match_time:"21:00", venue:"SoFi" },
    { id:"K2", home:"Colombia", away:"Uzbekistan", matchday:1, match_date:"2026-06-18", match_time:"15:00", venue:"BofA" },
    { id:"K3", home:"Portugal", away:"Uzbekistan", matchday:2, match_date:"2026-06-22", match_time:"21:00", venue:"SoFi" },
    { id:"K4", home:"Colombia", away:"DR Congo",   matchday:2, match_date:"2026-06-23", match_time:"15:00", venue:"BofA" },
    { id:"K5", home:"Portugal", away:"Colombia",   matchday:3, match_date:"2026-06-28", match_time:"21:00", venue:"SoFi" },
    { id:"K6", home:"DR Congo", away:"Uzbekistan", matchday:3, match_date:"2026-06-28", match_time:"21:00", venue:"BofA" },
  ],
  L: [
    { id:"L1", home:"England", away:"Croatia",  matchday:1, match_date:"2026-06-18", match_time:"21:00", venue:"HardRock" },
    { id:"L2", home:"Panama",  away:"Ghana",    matchday:1, match_date:"2026-06-18", match_time:"18:00", venue:"Gillette" },
    { id:"L3", home:"England", away:"Ghana",    matchday:2, match_date:"2026-06-23", match_time:"18:00", venue:"HardRock" },
    { id:"L4", home:"Panama",  away:"Croatia",  matchday:2, match_date:"2026-06-23", match_time:"15:00", venue:"Gillette" },
    { id:"L5", home:"England", away:"Panama",   matchday:3, match_date:"2026-06-28", match_time:"21:00", venue:"HardRock" },
    { id:"L6", home:"Croatia", away:"Ghana",    matchday:3, match_date:"2026-06-28", match_time:"21:00", venue:"Gillette" },
  ],
};

// ─── Dynamic Data Loading ─────────────────────────────────────────────────────
// matches state is loaded from DB in UserApp; static GF/GROUPS used for display
function mkT(dm) {
  return {
    bg: dm ? "#06090f" : "#eef1f8",
    surf: dm ? "#0f1623" : "#ffffff",
    surf2: dm ? "#172035" : "#f3f6fc",
    surf3: dm ? "#0b1220" : "#e8edf7",
    text: dm ? "#dde3f0" : "#1a2040",
    muted: dm ? "#5a6480" : "#7080a0",
    accent: "#c89b3c",
    blue: "#3b82f6",
    green: dm ? "#10b981" : "#059669",
    red: "#ef4444",
    purple: "#a855f7",
    orange: "#f97316",
    border: dm ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.09)",
    dm,
  };
}
const UCtx = createContext(null);
const useU = () => useContext(UCtx);
export default function Root() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}
function App() {
  const { session, profile, loading } = useAuth();
  const [dark, setDark] = useState(true);
  const T = mkT(dark);
  if (loading) return <Loader T={T} />;
  if (!session) return <AuthPage T={T} dark={dark} setDark={setDark} />;
  if (profile?.role === "admin")
    return <AdminApp T={T} dark={dark} setDark={setDark} />;
  return <UserApp T={T} dark={dark} setDark={setDark} />;
}
function GS({ T }) {
  const a = T.accent;
  return (
    <style>{`*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Rajdhani',sans-serif}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:${a}55;border-radius:4px}@keyframes fadeUp{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes glow{0%,100%{box-shadow:0 0 8px ${a}44}50%{box-shadow:0 0 24px ${a}99}}@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}.fade-up{animation:fadeUp .4s ease forwards}.nav-item:hover{background:${a}18!important;transform:translateX(2px)}.nav-item.active{background:${a}28!important;border-left:3px solid ${a}!important}.card-hover{transition:transform .2s,box-shadow .2s}.card-hover:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,.35)!important}.team-btn{transition:all .15s;cursor:pointer}.team-btn:hover{transform:scale(1.02)}.winner-glow{animation:glow 2s infinite}.trophy-spin{animation:spin 3.5s linear infinite}.celebrate{animation:pulse .5s ease infinite}button{cursor:pointer;border:none;outline:none;font-family:Rajdhani}input,select{font-family:Rajdhani}.chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}input[type=range]{accent-color:${a};cursor:pointer;width:100%}`}</style>
  );
}
function IField({ label, val, set, T, type = "text", ph = "" }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: T.muted,
          marginBottom: 5,
        }}
      >
        {label}
      </label>
      <input
        type={type}
        value={val}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
        style={{
          width: "100%",
          padding: "10px 12px",
          background: T.surf2,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          color: T.text,
          fontSize: 14,
          outline: "none",
        }}
      />
    </div>
  );
}
const COUNTRY_LIST = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia","Austria",
  "Azerbaijan","Bahrain","Bangladesh","Belarus","Belgium","Bolivia","Bosnia and Herzegovina",
  "Botswana","Brazil","Bulgaria","Burkina Faso","Cambodia","Cameroon","Canada","Cape Verde",
  "Chile","China","Colombia","Croatia","Cuba","Czechia","DR Congo","Denmark","Ecuador","Egypt",
  "El Salvador","Estonia","Ethiopia","Finland","France","Georgia","Germany","Ghana","Greece",
  "Guatemala","Guinea","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq",
  "Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan","Kazakhstan","Kenya",
  "Kuwait","Latvia","Lebanon","Libya","Lithuania","Luxembourg","Madagascar","Malaysia","Mali",
  "Malta","Mexico","Moldova","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Nepal",
  "Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia",
  "Norway","Oman","Pakistan","Palestine","Panama","Paraguay","Peru","Philippines","Poland",
  "Portugal","Qatar","Romania","Russia","Rwanda","Saudi Arabia","Scotland","Senegal","Serbia",
  "Sierra Leone","Singapore","Slovakia","Slovenia","Somalia","South Africa","South Korea",
  "Spain","Sri Lanka","Sudan","Sweden","Switzerland","Syria","Tanzania","Thailand","Tunisia",
  "Turkey","Uganda","Ukraine","United Arab Emirates","United Kingdom","USA","Uruguay","Uzbekistan",
  "Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"
];

function AuthPage({ T, dark, setDark }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [uname, setUname] = useState("");
  const [country, setCountry] = useState("");
  const [err, setErr]           = useState("");
  const [busy, setBusy]         = useState(false);
  // OTP step state
  const [otpStep, setOtpStep]   = useState(false); // showing OTP form?
  const [otp, setOtp]           = useState("");
  const [otpErr, setOtpErr]     = useState("");
  const [otpBusy, setOtpBusy]   = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  const sendOTP = async () => {
    try {
      const res = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username: uname }),
      });
      if (!res.ok && res.headers.get("content-type")?.includes("text/html")) {
        return { success: false, error: `Server error (${res.status}) — /api/send-otp not found` };
      }
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || "Network error sending OTP" };
    }
  };

  const submit = async () => {
    setErr("");
    setBusy(true);
    if (mode === "login") {
      const { error } = await signIn(email, pw);
      if (error) setErr(error.message);
    } else {
      if (!uname.trim()) { setErr("Username required"); setBusy(false); return; }

      const taken = await isUsernameTaken(uname);
      if (taken) { setErr("Username already exists"); setBusy(false); return; }

      const { data, error } = await signUp(email, pw, uname, country || null);

      // Supabase may throw "Error sending confirmation email" when its own email
      // system is disabled/rate-limited. The user account IS created in that case,
      // so treat it as a recoverable error and fall through to our OTP flow.
      const isSupabaseEmailError =
        error && /sending confirmation email|email.*not confirmed|confirm.*email/i.test(error.message);

      if (error && !isSupabaseEmailError) {
        // Real error (e.g. email already registered, weak password)
        setErr(error.message);
      } else {
        // Account created. When Supabase email confirmation is disabled it
        // immediately returns a session — sign out so the user stays on this
        // page during OTP verification. signIn() after OTP creates the real session.
        await signOut();

        const result = await sendOTP();
        if (result.success) {
          setOtpStep(true);
        } else {
          setErr(result.error || "Failed to send verification code");
        }
      }
    }
    setBusy(false);
  };

  const verifyOTP = async () => {
    setOtpErr("");
    setOtpBusy(true);
    const res  = await fetch("/api/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: otp }),
    });
    const result = await res.json();
    if (result.success) {
      // OTP verified. If Supabase hasn't auto-logged them in yet (confirmation enabled),
      // sign them in now with their password.
      const { error: signInErr } = await signIn(email, pw);
      if (signInErr) setOtpErr(`Verified! But sign-in failed: ${signInErr.message}`);
      // If already logged in (confirmation disabled), onAuthStateChange handles it.
    } else {
      setOtpErr(result.error || "Verification failed");
    }
    setOtpBusy(false);
  };

  const resendOTP = async () => {
    setResending(true);
    setResendMsg("");
    setOtpErr("");
    const result = await sendOTP();
    setResendMsg(result.success ? "New code sent! Check your inbox." : (result.error || "Failed to resend"));
    setResending(false);
  };
  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: "Rajdhani,sans-serif",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Oswald:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <GS T={T} />
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 60 }}>🏆</div>
          <h1
            style={{
              fontFamily: "Oswald",
              fontSize: 30,
              color: T.accent,
              letterSpacing: 2,
              marginTop: 6,
            }}
          >
            FIFA WC 2026
          </h1>
          <p style={{ color: T.muted, fontSize: 13, marginTop: 4 }}>
            Official Prediction Platform
          </p>
        </div>
        <div
          style={{
            background: T.surf,
            border: `1px solid ${T.border}`,
            borderRadius: 14,
            padding: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 0,
              marginBottom: 22,
              background: T.surf2,
              borderRadius: 9,
              padding: 4,
            }}
          >
            {["login", "register"].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: 7,
                  background: mode === m ? T.accent : "transparent",
                  color: mode === m ? "#000" : T.muted,
                  fontFamily: "Oswald",
                  fontSize: 14,
                  fontWeight: 700,
                  transition: "all .2s",
                }}
              >
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>
          {otpStep ? (
            /* ── OTP verification screen ────────────────────────── */
            <div>
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <div style={{ fontSize: 36 }}>📧</div>
                <div style={{ fontFamily: "Oswald", fontSize: 17, color: T.accent, marginTop: 6 }}>
                  Check your inbox
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.6 }}>
                  We sent a 6-digit code to<br />
                  <strong style={{ color: T.text }}>{email}</strong>
                </div>
              </div>

              {/* 6-digit OTP input */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 6, fontWeight: 600 }}>
                  Verification Code
                </div>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && verifyOTP()}
                  placeholder="000000"
                  maxLength={6}
                  style={{
                    width: "100%",
                    padding: "14px",
                    background: T.surf2,
                    border: `2px solid ${otpErr ? T.red : T.border}`,
                    borderRadius: 9,
                    color: T.accent,
                    fontSize: 28,
                    fontFamily: "monospace",
                    fontWeight: 700,
                    letterSpacing: 10,
                    textAlign: "center",
                    outline: "none",
                    transition: "border-color .2s",
                  }}
                />
              </div>

              {otpErr && (
                <div style={{ background: `${T.red}20`, border: `1px solid ${T.red}`, borderRadius: 8, padding: "9px 13px", marginBottom: 12, color: T.red, fontSize: 12 }}>
                  {otpErr}
                </div>
              )}

              <button
                onClick={verifyOTP}
                disabled={otpBusy || otp.length !== 6}
                style={{ width: "100%", padding: 12, background: otp.length === 6 ? T.accent : T.surf2, color: otp.length === 6 ? "#000" : T.muted, borderRadius: 9, fontFamily: "Oswald", fontSize: 16, fontWeight: 700, letterSpacing: 1, marginBottom: 12, opacity: otpBusy ? 0.7 : 1, transition: "all .2s" }}
              >
                {otpBusy ? "Verifying…" : "Verify Email"}
              </button>

              <div style={{ textAlign: "center" }}>
                <button
                  onClick={resendOTP}
                  disabled={resending}
                  style={{ background: "transparent", color: T.muted, fontSize: 12, border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  {resending ? "Sending…" : "Resend code"}
                </button>
                {resendMsg && (
                  <div style={{ fontSize: 11, color: resendMsg === "New code sent!" ? T.green : T.red, marginTop: 4 }}>
                    {resendMsg}
                  </div>
                )}
              </div>
            </div>
          ) : (
          /* ── Normal sign-in / register form ─────────────────── */
          <>
          {err && (
            <div
              style={{
                background: `${T.red}20`,
                border: `1px solid ${T.red}`,
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 14,
                color: T.red,
                fontSize: 13,
              }}
            >
              {err}
            </div>
          )}
          {mode === "register" && (
            <>
              <IField
                label="Username"
                val={uname}
                set={setUname}
                T={T}
                ph="yourname"
              />
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 5, fontWeight: 600 }}>
                  Country <span style={{ color: T.muted, fontWeight: 400 }}>(optional)</span>
                </div>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 11px",
                    background: T.surf2,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    color: country ? T.text : T.muted,
                    fontSize: 13,
                    fontFamily: "Rajdhani,sans-serif",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">Select your country…</option>
                  {COUNTRY_LIST.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <IField
            label="Email"
            val={email}
            set={setEmail}
            T={T}
            type="email"
            ph="you@example.com"
          />
          <IField
            label="Password"
            val={pw}
            set={setPw}
            T={T}
            type="password"
            ph="••••••••"
          />
          <button
            onClick={submit}
            disabled={busy}
            style={{
              width: "100%",
              padding: "12px",
              background: T.accent,
              color: "#000",
              borderRadius: 9,
              fontFamily: "Oswald",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 1,
              marginTop: 6,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy
              ? "Loading…"
              : mode === "login"
                ? "Sign In"
                : "Create Account"}
          </button>
          </>
          )}
        </div>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button
            onClick={() => setDark(!dark)}
            style={{
              background: "transparent",
              color: T.muted,
              fontSize: 12,
              border: "none",
              cursor: "pointer",
            }}
          >
            {dark ? "☀️ Light mode" : "🌙 Dark mode"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── localStorage cache helpers ──────────────────────────────────────────────
const LS_KEY = "wc2026_cache";
function lsRead() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "null") || {};
  } catch {
    return {};
  }
}
function lsWrite(patch) {
  try {
    const prev = lsRead();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {}
}
// ─────────────────────────────────────────────────────────────────────────────

function UserApp({ T, dark, setDark }) {
  const { profile } = useAuth();
  const [view, setView] = useState("home");
  const [sidebar, setSidebar] = useState(true);
  const [groupResults, setGR] = useState(() => lsRead().groupResults || {});
  const [groupQuals, setGQ] = useState(() => lsRead().groupQuals || {});
  const [knockouts, setKO] = useState(() => lsRead().knockouts || {});
  const [sfLosers, setSFL] = useState({});
  const [matchPreds, setMP] = useState(() => lsRead().matchPreds || {});
  const [leaderboard, setLB] = useState([]);
  const [matches, setMatches] = useState([]); // Dynamic matches from DB
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // ─── 1. Trigger API Sync on Mount (if API key exists) ───────────────────────
  useEffect(() => {
    const triggerSync = async () => {
      const apiKey = import.meta.env.VITE_API_FOOTBALL_KEY;
      if (!apiKey) {
        console.log("⚠️ API-Football key not set. Using cached data.");
        return;
      }
      if (!profile) return;
      
      setSyncing(true);
      const result = await syncMatchesWithAPI();
      setSyncing(false);
      
      if (result.success) {
        showToast(`✅ Synced ${result.synced} matches from API-Football`, "success");
      } else {
        console.error("Sync failed:", result.error);
        showToast("⚠️ Could not sync matches. Using cached data.", "error");
      }
    };
    triggerSync();
  }, [profile]);

  // ─── 2. Fetch Matches from Database ─────────────────────────────────────────
  useEffect(() => {
    if (!profile) return;
    loadMatches();
    loadAll();
    getLeaderboard(500).then(({ data }) => setLB(formatLeaderboard(data || [])));
    
    // Auto-refresh leaderboard every 60s
    const lbInterval = setInterval(() => {
      getLeaderboard(500).then(({ data }) => setLB(formatLeaderboard(data || [])));
    }, 60000);
    
    // Auto-refresh matches every 2min
    const matchInterval = setInterval(() => {
      loadMatches();
      loadAll();
    }, 120000);
    
    return () => {
      clearInterval(lbInterval);
      clearInterval(matchInterval);
    };
  }, [profile]);

  const loadMatches = async () => {
    const { data, error } = await getMatches();
    if (error) {
      console.error("Failed to load matches:", error);
      return;
    }
    setMatches(data || []);
  };

  const formatLeaderboard = (data) =>
    data.map((u, i) => ({
      ...u,
      rank: i + 1,
      // Use server-provided accuracy_pct (computed from stored profile totals,
      // accurate for every user). predictions_won = correct_bets (exact+correct).
      accuracy_pct: u.accuracy_pct ?? (
        u.total_predictions > 0
          ? Math.round((u.predictions_won || 0) / u.total_predictions * 100)
          : 0
      ),
      total_predictions: u.total_predictions || 0,
    }));

  // ─── 3. Load User Predictions (merge with DB data) ──────────────────────────
  const loadAll = async () => {
    const cached = lsRead();
    if (cached.matchPreds) setMP(cached.matchPreds);
    if (cached.groupResults) setGR(cached.groupResults);
    if (cached.groupQuals) setGQ(cached.groupQuals);
    if (cached.knockouts) setKO(cached.knockouts);

    const [mp, gq, kp] = await Promise.all([
      getUserPredictions(profile.id),
      getUserGroupQuals(profile.id),
      getUserKnockoutPreds(profile.id),
    ]);

    const grMap = {};
    mp.data?.forEach((p) => {
      const g = p.match_id.substring(0, 1); // Extract group from match ID
      if (!grMap[g]) grMap[g] = {};
      grMap[g][p.match_id] = {
        homeScore: p.predicted_home_score,
        awayScore: p.predicted_away_score,
      };
    });
    setGR((prev) => {
      const merged = { ...grMap };
      Object.keys(prev).forEach((g) => {
        merged[g] = { ...(merged[g] || {}), ...(prev[g] || {}) };
      });
      return merged;
    });

    const qualMap = {};
    gq.data?.forEach((q) => {
      qualMap[q.group_id] = {
        first: q.predicted_first,
        second: q.predicted_second,
      };
    });
    setGQ((prev) => ({ ...qualMap, ...prev }));

    const mpMap = {};
    mp.data?.forEach((p) => {
      mpMap[p.match_id] = p;
    });
    setMP((prev) => ({ ...mpMap, ...prev }));

    const koMap = {};
    kp.data?.forEach((p) => {
      koMap[`${p.stage}-${p.slot_index}`] = p.predicted_winner;
    });
    setKO((prev) => ({ ...koMap, ...prev }));

    const currentCache = lsRead();
    lsWrite({
      groupResults: { ...grMap, ...(currentCache.groupResults || {}) },
      groupQuals: { ...qualMap, ...(currentCache.groupQuals || {}) },
      matchPreds: { ...mpMap, ...(currentCache.matchPreds || {}) },
      knockouts: { ...koMap, ...(currentCache.knockouts || {}) },
    });
  };
const showToast = (msg, type = "success") => {
  setToast({ msg, type });
  setTimeout(() => setToast(null), 3500);
};

const savePrediction = async (gId, matchId, hs, as) => {
  if (!profile) return;
  setSaving(true);
  
  // Find match from dynamic matches array
  const match = matches.find((m) => m.id === matchId);
  const pred = hs > as ? "home" : as > hs ? "away" : "draw";
  
  // Calculate odds based on actual match data
  const odds = calculateMatchOdds(
    match?.home_team || "TBD",
    match?.away_team || "TBD",
    pred,
    "group",
  );
  
  // ── Optimistic update: persist to localStorage immediately ────────────────
  const optimistic = {
    user_id: profile.id,
    match_id: matchId,
    predicted_home_score: hs,
    predicted_away_score: as,
    predicted_winner: pred,
    stake_amount: 10,
    odds_at_submission: odds.selected,
    potential_payout: parseFloat((10 * odds.selected).toFixed(2)),
  };
  setGR((prev) => {
    const next = {
      ...prev,
      [gId]: {
        ...(prev[gId] || {}),
        [matchId]: { homeScore: hs, awayScore: as },
      },
    };
    lsWrite({ groupResults: next });
    return next;
  });
  setMP((prev) => {
    const next = { ...prev, [matchId]: optimistic };
    lsWrite({ matchPreds: next });
    return next;
  });
  
  // ── Supabase persist (with server-side lock check) ─────────────────────────
  const { data, error } = await upsertPrediction(optimistic);
  if (error) {
    showToast(error.message, "error");
    setSaving(false);
    // Revert optimistic update
    loadAll();
    return;
  }
  
  const savedPrediction = data || optimistic;
  setMP((prev) => {
    const next = { ...prev, [matchId]: savedPrediction };
    lsWrite({ matchPreds: next });
    return next;
  });
  
  setSaving(false);
  return savedPrediction;
};
  const saveGroupQual = async (groupId, first, second) => {
    if (!profile) return;
    // ── Optimistic update ─────────────────────────────────────────────────────
    setGQ((prev) => {
      const next = { ...prev, [groupId]: { first, second } };
      lsWrite({ groupQuals: next });
      return next;
    });
    showToast(`✓ Group ${groupId} qualifiers saved`);
    // ── Supabase persist ──────────────────────────────────────────────────────
    const { data, error } = await upsertGroupQual({
      user_id: profile.id,
      group_id: groupId,
      predicted_first: first,
      predicted_second: second,
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    const savedQual = data || {
      predicted_first: first,
      predicted_second: second,
    };
    setGQ((prev) => {
      const next = {
        ...prev,
        [groupId]: {
          first: savedQual.predicted_first,
          second: savedQual.predicted_second,
        },
      };
      lsWrite({ groupQuals: next });
      return next;
    });
  };
  const saveKO = async (stage, idx, winner) => {
    if (!profile) return;
    // ── Optimistic update ─────────────────────────────────────────────────────
    setKO((prev) => {
      const next = { ...prev, [`${stage}-${idx}`]: winner };
      lsWrite({ knockouts: next });
      return next;
    });
    if (stage === "sf") {
      const b = SF_BRACKET[idx];
      if (b) {
        const h = resolve(b.homeSlot),
          a = resolve(b.awaySlot);
        setSFL((prev) => ({ ...prev, [`sf-${idx}`]: winner === h ? a : h }));
      }
    }
    showToast(`${winner} picked!`);
    // ── Supabase persist ──────────────────────────────────────────────────────
    const { error } = await upsertKnockoutPred({
      user_id: profile.id,
      stage,
      slot_index: idx,
      predicted_winner: winner,
    });
    if (error) showToast(error.message, "error");
  };
  // Derive qualification state from user's group predictions
  const qual = useMemo(
    () => deriveQualification(GROUPS, GF, groupResults),
    [groupResults],
  );
  const resolve = useCallback(
    (slot) => resolveSlot(slot, qual, knockouts, sfLosers),
    [qual, knockouts, sfLosers],
  );

  const totalPreds = Object.keys(matchPreds).length;
  const accMul = getAccumulatorMultiplier(totalPreds);
  const nav = [
    { id: "home", icon: "🏠", label: "Home" },
    { id: "groups", icon: "🏟", label: "Group Stage" },
    { id: "standings", icon: "📊", label: "All Standings" },
    { id: "thirds", icon: "🥉", label: "3rd Place Race" },
    { id: "r32", icon: "32", label: "Round of 32" },
    { id: "r16", icon: "16", label: "Round of 16" },
    { id: "qf", icon: "⚡", label: "Quarter Finals" },
    { id: "sf", icon: "🌟", label: "Semi Finals" },
    { id: "tp", icon: "🥉", label: "3rd Place Match" },
    { id: "final", icon: "🏆", label: "The Final" },
    { id: "bracket", icon: "🌐", label: "Full Bracket" },
    { id: "leaderboard", icon: "🏅", label: "Leaderboard" },
    { id: "mypreds", icon: "📋", label: "My Predictions" },
  ];
  const ctx = {
    T,
    profile,
    groupResults,
    groupQuals,
    matchPreds,
    knockouts,
    sfLosers,
    qual,
    resolve,
    matches,
    savePrediction,
    saveGroupQual,
    saveKO,
    saving,
    leaderboard,
    totalPreds,
    accMul,
    showToast,
  };
  return (
    <UCtx.Provider value={ctx}>
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: T.bg,
          fontFamily: "Rajdhani,sans-serif",
          color: T.text,
        }}
      >
        <link
          href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Oswald:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <GS T={T} />
        {toast && <Toast msg={toast.msg} type={toast.type} T={T} />}
        <aside
          style={{
            width: sidebar ? 228 : 62,
            minWidth: sidebar ? 228 : 62,
            background: T.dm ? "#06090f" : "#111827",
            borderRight: `1px solid ${T.border}`,
            display: "flex",
            flexDirection: "column",
            transition: "width .3s",
            position: "sticky",
            top: 0,
            height: "100vh",
            overflow: "hidden",
            flexShrink: 0,
            zIndex: 10,
          }}
        >
          <div
            style={{
              padding: "13px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 24, flexShrink: 0 }}>🏆</span>
            {sidebar && (
              <div>
                <div
                  style={{
                    fontFamily: "Oswald",
                    fontSize: 13,
                    fontWeight: 700,
                    color: T.accent,
                    letterSpacing: 1,
                  }}
                >
                  FIFA WC 2026
                </div>
                <div style={{ fontSize: 10, color: T.muted }}>
                  Prediction Platform
                </div>
              </div>
            )}
          </div>
          {sidebar && profile && (
            <div
              style={{
                padding: "9px 12px",
                borderBottom: `1px solid ${T.border}`,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: `${T.accent}33`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  color: T.accent,
                  flexShrink: 0,
                }}
              >
                {profile.username[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {profile.username}
                </div>
                <div style={{ fontSize: 10, color: T.accent }}>
                  {profile.total_points || 0} pts · {fmtOdds(accMul)}
                </div>
              </div>
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto", padding: "5px 0" }}>
            {nav.map((item) => (
              <div
                key={item.id}
                onClick={() => setView(item.id)}
                className={`nav-item${view === item.id ? " active" : ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 13px",
                  borderLeft: "3px solid transparent",
                  cursor: "pointer",
                  color: view === item.id ? T.accent : T.text,
                }}
              >
                <span
                  style={{
                    fontSize:
                      /\d/.test(item.icon) && item.icon.length <= 2 ? 11 : 16,
                    fontWeight: 700,
                    minWidth: 22,
                    textAlign: "center",
                    color: view === item.id ? T.accent : T.muted,
                  }}
                >
                  {item.icon}
                </span>
                {sidebar && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.label}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div
            style={{
              padding: "9px",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            <button
              onClick={() => setDark(!dark)}
              style={{
                background: T.surf2,
                color: T.text,
                borderRadius: 7,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
              }}
            >
              {dark ? "☀️" : "🌙"}
              {sidebar && (dark ? " Light" : " Dark")}
            </button>
            {sidebar && (
              <button
                onClick={() => signOut()}
                style={{
                  background: "#7f1d1d33",
                  color: "#ef4444",
                  borderRadius: 7,
                  padding: "6px",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Sign Out
              </button>
            )}
          </div>
        </aside>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <header
            style={{
              background: T.dm ? "#06090f" : "#111827",
              borderBottom: `1px solid ${T.border}`,
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              position: "sticky",
              top: 0,
              zIndex: 9,
            }}
          >
            <button
              onClick={() => setSidebar(!sidebar)}
              style={{
                background: "transparent",
                color: "white",
                fontSize: 18,
                padding: 2,
                border: "none",
                cursor: "pointer",
              }}
            >
              ☰
            </button>
            <span
              style={{
                fontFamily: "Oswald",
                fontSize: 17,
                fontWeight: 700,
                color: "white",
                letterSpacing: 1,
              }}
            >
              {nav.find((n) => n.id === view)?.icon}{" "}
              {nav.find((n) => n.id === view)?.label}
            </span>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {saving && (
                <span style={{ fontSize: 11, color: T.accent }}>
                  💾 Saving…
                </span>
              )}
              <div
                style={{
                  background: `${T.accent}22`,
                  border: `1px solid ${T.accent}44`,
                  borderRadius: 20,
                  padding: "3px 12px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: T.accent,
                }}
              >
                {profile?.total_points || 0} pts · {fmtOdds(accMul)}
              </div>
            </div>
          </header>
          <main style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
            {view === "home" && <HomeView />}
            {view === "groups" && <GroupPredictions />}
            {view === "standings" && <AllStandings />}
            {view === "thirds" && <ThirdPlaceRace />}
            {view === "r32" && (
              <KnockoutView
                stage="r32"
                title="Round of 32"
                bracket={R32_BRACKET}
              />
            )}
            {view === "r16" && (
              <KnockoutView
                stage="r16"
                title="Round of 16"
                bracket={R16_BRACKET}
              />
            )}
            {view === "qf" && (
              <KnockoutView
                stage="qf"
                title="Quarter Finals"
                bracket={QF_BRACKET}
              />
            )}
            {view === "sf" && (
              <KnockoutView
                stage="sf"
                title="Semi Finals"
                bracket={SF_BRACKET}
              />
            )}
            {view === "tp" && <ThirdPlaceMatchView />}
            {view === "final" && <FinalView />}
            {view === "bracket" && <FullBracket />}
            {view === "leaderboard" && <LeaderboardView />}
            {view === "mypreds" && <MyPredictions />}
          </main>
        </div>
      </div>
    </UCtx.Provider>
  );
}

function HomeView() {
  const { T, profile, matchPreds, knockouts, leaderboard, accMul, totalPreds } =
    useU();
  const myRank = leaderboard.findIndex((u) => u.id === profile?.id) + 1;
  return (
    <div className="fade-up">
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ fontSize: 52 }}>🌎</div>
        <h1
          style={{
            fontFamily: "Oswald",
            fontSize: 34,
            color: T.accent,
            letterSpacing: 2,
            marginTop: 6,
          }}
        >
          FIFA WORLD CUP 2026
        </h1>
        <p style={{ color: T.muted, fontSize: 13, marginTop: 3 }}>
          Welcome,{" "}
          <strong style={{ color: T.text }}>{profile?.username}</strong> — USA ·
          Canada · Mexico
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
          gap: 11,
          marginBottom: 20,
        }}
      >
        {[
          {
            icon: "🏆",
            label: "Points",
            val: profile?.total_points || 0,
            color: T.accent,
          },
          {
            icon: "📊",
            label: "Global Rank",
            val: myRank ? `#${myRank}` : "—",
            color: T.blue,
          },
          {
            icon: "⚽",
            label: "Match Preds",
            val: `${totalPreds}/72`,
            color: T.green,
          },
          {
            icon: "🔮",
            label: "KO Picks",
            val: Object.keys(knockouts).length,
            color: T.purple,
          },
          {
            icon: "⚡",
            label: "Accumulator",
            val: fmtOdds(accMul),
            color: T.orange,
          },
          {
            icon: "🎯",
            label: "Accuracy",
            val:
              profile?.total_bets > 0
                ? `${Math.round((profile.correct_bets / profile.total_bets) * 100)}%`
                : "—",
            color: T.green,
          },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              background: T.surf,
              border: `1px solid ${T.border}`,
              borderRadius: 11,
              padding: "13px 10px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 4 }}>{s.icon}</div>
            <div
              style={{
                fontFamily: "Oswald",
                fontSize: 20,
                fontWeight: 700,
                color: s.color,
              }}
            >
              {s.val}
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          background: T.surf,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <h3
          style={{
            fontFamily: "Oswald",
            fontSize: 16,
            color: T.accent,
            marginBottom: 14,
          }}
        >
          🗺️ How Qualification Works
        </h3>
        {[
          {
            icon: "1️⃣",
            title: "Predict Group Matches (optional)",
            desc: "Score predictions for any of the 72 group fixtures. Standings calculate live with FIFA tie-breaking rules.",
          },
          {
            icon: "2️⃣",
            title: "Top 2 from Each Group Auto-Qualify (24 teams)",
            desc: "1st and 2nd from each of 12 groups (A–L) advance automatically to Round of 32.",
          },
          {
            icon: "3️⃣",
            title: "Best 8 of 12 Third-Placed Teams Also Qualify",
            desc: "All 12 third-place finishers ranked together by Points → GD → GF. Top 8 qualify — from ANY group, not just A–H.",
          },
          {
            icon: "4️⃣",
            title: "32 Teams Enter the Fixed Knockout Bracket",
            desc: "Winners + Runners-up + Best 8 thirds = 32 teams in fixed FIFA bracket positions. No reshuffling.",
          },
          {
            icon: "5️⃣",
            title: "Predict All the Way to the Champion",
            desc: "Click through R32 → R16 → QF → SF → 3rd Place Match → Final to crown your World Champion.",
          },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              padding: "9px 0",
              borderBottom: i < 4 ? `1px solid ${T.border}` : undefined,
            }}
          >
            <span style={{ fontSize: 18, flexShrink: 0 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                {s.title}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                {s.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          background: T.surf,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 18,
        }}
      >
        <h3
          style={{
            fontFamily: "Oswald",
            fontSize: 16,
            color: T.accent,
            marginBottom: 12,
          }}
        >
          ⚡ Accumulator Reward Tiers
        </h3>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}
        >
          {[
            ["1 match", "1.2x"],
            ["5 matches", "2.5x"],
            ["10 matches", "5x"],
            ["20 matches", "12x"],
            ["Full Group Stage", "35x"],
            ["Full R32 Bracket", "50x"],
            ["Full R16 Bracket", "80x"],
            ["Predict Champion", "250x+"],
          ].map(([label, odds], i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 10px",
                background: T.surf2,
                borderRadius: 8,
                border: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 11, color: T.text }}>{label}</span>
              <span
                style={{
                  fontFamily: "Oswald",
                  fontSize: 14,
                  fontWeight: 700,
                  color: T.accent,
                }}
              >
                {odds}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupPredictions() {
  const { T, matchPreds, groupQuals, saveGroupQual, savePrediction, matches } = useU();
  const [ag, setAg] = useState("A");
  // Derive qualifier picks directly from context — no local state race condition
  const savedFirst = groupQuals[ag]?.first || "";
  const savedSecond = groupQuals[ag]?.second || "";
  // Local edit state — only used while user is making changes before saving
  const [firstPick, setFirstPick] = useState(savedFirst);
  const [secondPick, setSecondPick] = useState(savedSecond);
  const [af, setAf] = useState(0);
  const [qualSaveStatus, setQualSaveStatus] = useState(
    savedFirst && savedSecond ? "saved" : "idle",
  );
  const qualDebounceRef = useRef(null);
  const qualSavedTimerRef = useRef(null);
  const qualDirtyRef = useRef(false);
  const qualPendingRef = useRef({ first: "", second: "" });
  const fixtures = GF[ag];
  const match = fixtures[af];
  // Sync local edit state from context whenever ag changes OR groupQuals updates
  // This is the critical fix: always override local state with context truth
  useEffect(() => {
    setFirstPick(groupQuals[ag]?.first || "");
    setSecondPick(groupQuals[ag]?.second || "");
  }, [ag, groupQuals[ag]?.first, groupQuals[ag]?.second]);

  // Debounced auto-save for qualifier picks
  const triggerQualAutoSave = useCallback(
    (f, s) => {
      if (!f || !s || f === s) return;
      qualDirtyRef.current = true;
      qualPendingRef.current = { first: f, second: s };
      setQualSaveStatus("dirty");
      clearTimeout(qualDebounceRef.current);
      clearTimeout(qualSavedTimerRef.current);
      qualDebounceRef.current = setTimeout(async () => {
        qualDirtyRef.current = false;
        setQualSaveStatus("saving");
        await saveGroupQual(ag, f, s);
        setQualSaveStatus("saved");
        qualSavedTimerRef.current = setTimeout(
          () => setQualSaveStatus("idle"),
          3000,
        );
      }, 800);
    },
    [ag, saveGroupQual],
  );

  // Flush pending qualifier save on unmount
  useEffect(
    () => () => {
      clearTimeout(qualDebounceRef.current);
      clearTimeout(qualSavedTimerRef.current);
      if (qualDirtyRef.current) {
        const { first, second } = qualPendingRef.current;
        if (first && second && first !== second) {
          saveGroupQual(ag, first, second);
        }
      }
    },
    [ag, saveGroupQual],
  );

  const QualSaveIndicator = () => {
    if (qualSaveStatus === "saving")
      return (
        <span
          style={{
            fontSize: 11,
            color: T.muted,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              border: `2px solid ${T.accent}`,
              borderTopColor: "transparent",
              animation: "spin .7s linear infinite",
            }}
          />
          Saving…
        </span>
      );
    if (qualSaveStatus === "saved")
      return (
        <span
          style={{
            fontSize: 11,
            color: T.green,
            display: "flex",
            alignItems: "center",
            gap: 4,
            animation: "fadeUp .3s ease",
          }}
        >
          <span style={{ fontSize: 13 }}>✓</span> Saved
        </span>
      );
    if (qualSaveStatus === "dirty")
      return (
        <span
          style={{
            fontSize: 11,
            color: T.orange,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: T.orange,
              animation: "pulse .8s ease infinite",
            }}
          />
          Unsaved
        </span>
      );
    return null;
  };

  return (
    <div className="fade-up">
      <div
        style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}
      >
        {Object.keys(GROUPS).map((g) => {
          const dc = (GF[g] || []).filter((f) => matchPreds[f.id]).length;
          return (
            <button
              key={g}
              onClick={() => {
                setAg(g);
                setAf(0);
              }}
              style={{
                padding: "5px 12px",
                borderRadius: 7,
                fontFamily: "Oswald",
                fontSize: 13,
                fontWeight: 600,
                background: ag === g ? T.accent : "transparent",
                color: ag === g ? "#000" : T.muted,
                border: `1px solid ${ag === g ? T.accent : T.border}`,
                transition: "all .2s",
                position: "relative",
              }}
            >
              Grp {g}
              {dc > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -5,
                    fontSize: 9,
                    background: T.green,
                    color: "#fff",
                    borderRadius: "50%",
                    width: 16,
                    height: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {dc}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 14 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((md) => (
            <div
              key={md}
              style={{
                background: T.surf,
                border: `1px solid ${T.border}`,
                borderRadius: 11,
                padding: 11,
              }}
            >
              <div
                style={{
                  fontFamily: "Oswald",
                  fontSize: 12,
                  color: T.accent,
                  marginBottom: 7,
                }}
              >
                Matchday {md}
              </div>
              {fixtures
                .filter((f) => f.matchday === md)
                .map((f) => {
                  const p = matchPreds[f.id];
                  const fi = fixtures.indexOf(f);
                  const dbM = matches.find((m) => m.id === f.id);
                  const mStatus = dbM?.status || "upcoming";
                  const mDeadline = new Date(
                    new Date(`${f.match_date}T${f.match_time}Z`).getTime() - 30 * 60000,
                  );
                  const fiLocked =
                    mStatus === "live" ||
                    mStatus === "finished" ||
                    new Date() >= mDeadline;
                  return (
                    <div
                      key={f.id}
                      onClick={() => setAf(fi)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "6px 8px",
                        borderRadius: 7,
                        marginBottom: 4,
                        cursor: "pointer",
                        background: af === fi ? `${T.accent}1a` : T.surf2,
                        border: `1px solid ${af === fi ? T.accent : T.border}`,
                        transition: "all .15s",
                        opacity: fiLocked && !p ? 0.6 : 1,
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{FLAG(f.home)}</span>
                      <span style={{ flex: 1, fontSize: 10, fontWeight: 600 }}>
                        {f.home}
                      </span>
                      {p ? (
                        <span
                          style={{
                            fontFamily: "Oswald",
                            fontSize: 12,
                            color: T.accent,
                            fontWeight: 700,
                          }}
                        >
                          {p.predicted_home_score}–{p.predicted_away_score}
                        </span>
                      ) : (
                        <span style={{ fontSize: 9, color: T.muted }}>
                          {f.match_date?.slice(5)}
                        </span>
                      )}
                      <span
                        style={{
                          flex: 1,
                          fontSize: 10,
                          fontWeight: 600,
                          textAlign: "right",
                        }}
                      >
                        {f.away}
                      </span>
                      <span style={{ fontSize: 13 }}>{FLAG(f.away)}</span>
                      {mStatus === "live" && (
                        <span style={{ fontSize: 9, color: T.green }}>●</span>
                      )}
                      {mStatus === "finished" && (
                        <span style={{ fontSize: 9, color: T.muted }}>✓</span>
                      )}
                      {p && mStatus !== "live" && mStatus !== "finished" &&
                        (fiLocked ? (
                          <span style={{ fontSize: 9, color: T.red }}>🔒</span>
                        ) : (
                          <span style={{ fontSize: 9, color: T.green }}>✓</span>
                        ))}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              background: T.surf,
              border: `1px solid ${T.border}`,
              borderRadius: 13,
              padding: 16,
            }}
          >
            <div
              style={{
                fontFamily: "Oswald",
                fontSize: 15,
                color: T.accent,
                marginBottom: 8,
              }}
            >
              🏆 Pick who qualifies from Group {ag}
            </div>
            <p style={{ color: T.muted, fontSize: 12, marginBottom: 10 }}>
              You can skip the score prediction and just save your top two
              teams.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <label
                style={{ display: "flex", flexDirection: "column", gap: 5 }}
              >
                <span style={{ fontSize: 12, color: T.muted }}>1st place</span>
                <select
                  value={firstPick}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFirstPick(v);
                    triggerQualAutoSave(v, secondPick);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${T.border}`,
                    background: T.surf2,
                    color: T.text,
                  }}
                >
                  <option value="">Select team</option>
                  {GROUPS[ag].teams.map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{ display: "flex", flexDirection: "column", gap: 5 }}
              >
                <span style={{ fontSize: 12, color: T.muted }}>2nd place</span>
                <select
                  value={secondPick}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSecondPick(v);
                    triggerQualAutoSave(firstPick, v);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${T.border}`,
                    background: T.surf2,
                    color: T.text,
                  }}
                >
                  <option value="">Select team</option>
                  {GROUPS[ag].teams.map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <button
                onClick={() => {
                  if (!firstPick || !secondPick) {
                    alert("Choose both a first and second place team.");
                    return;
                  }
                  if (firstPick === secondPick) {
                    alert("Pick two different teams.");
                    return;
                  }
                  clearTimeout(qualDebounceRef.current);
                  clearTimeout(qualSavedTimerRef.current);
                  qualDirtyRef.current = false;
                  setQualSaveStatus("saving");
                  saveGroupQual(ag, firstPick, secondPick).then(() => {
                    setQualSaveStatus("saved");
                    qualSavedTimerRef.current = setTimeout(
                      () => setQualSaveStatus("idle"),
                      3000,
                    );
                  });
                }}
                disabled={qualSaveStatus === "saving"}
                style={{
                  background:
                    qualSaveStatus === "saved" ? `${T.green}22` : T.accent,
                  color: qualSaveStatus === "saved" ? T.green : "#000",
                  border: `1px solid ${qualSaveStatus === "saved" ? T.green : "transparent"}`,
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontFamily: "Oswald",
                  fontSize: 13,
                  fontWeight: 700,
                  opacity: qualSaveStatus === "saving" ? 0.6 : 1,
                  transition: "all .25s",
                }}
              >
                {qualSaveStatus === "saving"
                  ? "Saving…"
                  : qualSaveStatus === "saved"
                    ? "✓ Saved"
                    : "Save"}
              </button>
              <QualSaveIndicator />
            </div>
          </div>
          <MatchLinePredictor
            key={match.id}
            match={match}
            groupId={ag}
            existing={matchPreds[match.id]}
            onSave={(hs, as) => savePrediction(ag, match.id, hs, as)}
            T={T}
          />
        </div>
      </div>
    </div>
  );
}

// ── Save-status values ─────────────────────────────────────────────────────
const SAVE_STATUS = {
  idle: "idle",
  dirty: "dirty",
  saving: "saving",
  saved: "saved",
};

function MatchLinePredictor({ match, groupId, existing, onSave, T }) {
  const { matches: dbMatches } = useU();
  const dbMatch = dbMatches.find((m) => m.id === match.id);
  const apiStatus = dbMatch?.status || "upcoming"; // upcoming | live | finished
  const matchStatus = dbMatch?.match_status || null; // granular: "1st Half", "Half Time", etc.

  // ── Lock Logic ─────────────────────────────────────────────────────────────
  // Lock if: API says live/finished, OR 30-min deadline passed, OR DB says locked
  const matchTime = new Date(`${match.match_date}T${match.match_time}Z`); // treat as UTC
  const now = new Date();
  const deadline = new Date(matchTime.getTime() - 30 * 60000);
  const isTimeLocked = now >= deadline;
  const isApiLocked = apiStatus === "live" || apiStatus === "finished";
  const isLocked = existing?.is_locked || isTimeLocked || isApiLocked;

  // ── Status Badge Helper ─────────────────────────────────────────────────────
  const getStatusBadge = () => {
    if (apiStatus === "finished") return { text: "Finished", color: T.muted, bg: `${T.muted}20` };
    if (apiStatus === "live") return { text: matchStatus || "Live", color: T.green, bg: `${T.green}20` };
    if (isTimeLocked) return { text: "Prediction Closed", color: T.red, bg: `${T.red}20` };
    const minsLeft = (deadline - now) / 60000;
    if (minsLeft <= 120) {
      const h = Math.floor(minsLeft / 60);
      const m = Math.floor(minsLeft % 60);
      const label = h > 0 ? `Closes in ${h}h ${m}m` : `Closes in ${m}m`;
      return { text: label, color: T.orange, bg: `${T.orange}20` };
    }
    return { text: "Prediction Open", color: T.green, bg: `${T.green}20` };
  };
  const statusBadge = getStatusBadge();

  const [hg, setHg] = useState(() => existing?.predicted_home_score ?? 0);
  const [ag2, setAg2] = useState(() => existing?.predicted_away_score ?? 0);
  const [commOdds, setCommOdds] = useState(null);
  const [saveStatus, setSaveStatus] = useState(
    existing ? SAVE_STATUS.saved : SAVE_STATUS.idle,
  );

  // Sync local state when existing prop changes
  useEffect(() => {
    const incomingH = existing?.predicted_home_score ?? 0;
    const incomingA = existing?.predicted_away_score ?? 0;
    setHg(incomingH);
    setAg2(incomingA);
    if (existing) setSaveStatus(SAVE_STATUS.saved);
    getCommunityOdds(match.id).then(({ data }) => setCommOdds(data));
  }, [
    match.id,
    existing?.predicted_home_score ?? -1,
    existing?.predicted_away_score ?? -1,
  ]);

  // Save on every score change — but block if locked
  const doSave = useCallback(
    async (h, a) => {
      if (isLocked) return; // ⛔ BLOCK SAVE if 30 min deadline passed
      setSaveStatus(SAVE_STATUS.saving);
      await onSave(h, a);
      setSaveStatus(SAVE_STATUS.saved);
      setTimeout(
        () =>
          setSaveStatus((s) =>
            s === SAVE_STATUS.saved ? SAVE_STATUS.idle : s,
          ),
        3000,
      );
    },
    [isLocked, onSave],
  );

  const handleSetHg = (v) => {
    if (isLocked) return; // ⛔ BLOCK INPUT
    const a = ag2;
    setHg(v);
    doSave(v, a);
  };
  const handleSetAg2 = (v) => {
    if (isLocked) return; // ⛔ BLOCK INPUT
    const h = hg;
    setAg2(v);
    doSave(h, v);
  };

  const chartData = [
    { min: "KO", h: 0, a: 0 },
    { min: "15'", h: +(hg * 0.15).toFixed(2), a: +(ag2 * 0.15).toFixed(2) },
    { min: "30'", h: +(hg * 0.35).toFixed(2), a: +(ag2 * 0.35).toFixed(2) },
    { min: "HT", h: +(hg * 0.5).toFixed(2), a: +(ag2 * 0.5).toFixed(2) },
    { min: "60'", h: +(hg * 0.65).toFixed(2), a: +(ag2 * 0.65).toFixed(2) },
    { min: "75'", h: +(hg * 0.85).toFixed(2), a: +(ag2 * 0.85).toFixed(2) },
    { min: "FT", h: hg, a: ag2 },
  ];
  const winner = hg > ag2 ? match.home : ag2 > hg ? match.away : null;
  const pred = hg > ag2 ? "home" : ag2 > hg ? "away" : "draw";
  const odds = calculateMatchOdds(
    match.home,
    match.away,
    pred,
    "group",
    commOdds,
  );
  const oddsInfo = getOddsLabel(odds.selected);
  const Dot = ({ cx, cy, fill }) =>
    cx !== undefined ? (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={fill}
        stroke={T.dm ? "#06090f" : "#fff"}
        strokeWidth={2}
      />
    ) : null;
  const TTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div
        style={{
          background: T.surf,
          border: `1px solid ${T.border}`,
          borderRadius: 7,
          padding: "7px 11px",
          fontSize: 11,
        }}
      >
        <div style={{ color: T.muted, fontWeight: 700, marginBottom: 3 }}>
          {label}
        </div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color, fontWeight: 600 }}>
            {p.name === "h" ? match.home : match.away}: {p.value.toFixed(1)}
          </div>
        ))}
      </div>
    );
  };

  // ── Save status indicator ─────────────────────────────────────────────────
  const SaveIndicator = () => {
    if (isLocked) return null;
    if (saveStatus === SAVE_STATUS.saving)
      return (
        <span
          style={{
            fontSize: 11,
            color: T.muted,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              border: `2px solid ${T.accent}`,
              borderTopColor: "transparent",
              animation: "spin .7s linear infinite",
            }}
          />
          Saving…
        </span>
      );
    if (saveStatus === SAVE_STATUS.saved)
      return (
        <span
          style={{
            fontSize: 11,
            color: T.green,
            display: "flex",
            alignItems: "center",
            gap: 4,
            animation: "fadeUp .3s ease",
          }}
        >
          <span style={{ fontSize: 13 }}>✓</span> Saved
        </span>
      );
    if (saveStatus === SAVE_STATUS.dirty)
      return (
        <span
          style={{
            fontSize: 11,
            color: T.orange,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: T.orange,
              animation: "pulse .8s ease infinite",
            }}
          />
          Unsaved
        </span>
      );
    return null;
  };

  return (
    <div
      style={{
        background: T.surf,
        border: `1px solid ${
          isLocked
            ? T.red
            : saveStatus === SAVE_STATUS.saved
              ? `${T.green}55`
              : saveStatus === SAVE_STATUS.dirty
                ? `${T.orange}55`
                : T.border
        }`,
        borderRadius: 13,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 13,
        transition: "border-color .3s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div style={{ fontSize: 10, color: T.muted }}>
          📅 {match.match_date} · 🕐 {match.match_time} UTC · 📍{" "}
          {VENUES[match.venue] || match.venue}
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 12,
            background: statusBadge.bg,
            color: statusBadge.color,
            border: `1px solid ${statusBadge.color}44`,
          }}
        >
          {statusBadge.text}
        </span>
      </div>
      {isLocked && apiStatus !== "live" && apiStatus !== "finished" && (
        <div
          style={{
            background: `${T.red}15`,
            border: `1px solid ${T.red}44`,
            borderRadius: 8,
            padding: "7px 12px",
            fontSize: 12,
            color: T.red,
            textAlign: "center",
          }}
        >
          🔒 Prediction locked — deadline passed 30 min before kick-off
        </div>
      )}
      {(apiStatus === "live" || apiStatus === "finished") && (
        <div
          style={{
            background: apiStatus === "live" ? `${T.green}15` : `${T.muted}15`,
            border: `1px solid ${apiStatus === "live" ? T.green : T.muted}44`,
            borderRadius: 8,
            padding: "7px 12px",
            fontSize: 12,
            color: apiStatus === "live" ? T.green : T.muted,
            textAlign: "center",
          }}
        >
          {apiStatus === "live"
            ? `⚽ Match in progress — ${matchStatus || "Live"}`
            : `✅ Match finished${dbMatch?.actual_home_score != null ? ` · Final: ${dbMatch.actual_home_score}–${dbMatch.actual_away_score}` : ""}`}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 10,
        }}
      >
        {[match.home, match.away].map((team, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36 }}>{FLAG(team)}</div>
            <div
              style={{
                fontFamily: "Oswald",
                fontSize: 13,
                fontWeight: 700,
                color: winner === team ? (i === 0 ? T.accent : T.blue) : T.text,
                marginTop: 3,
              }}
            >
              {team}
            </div>
            <div style={{ fontSize: 9, color: T.muted }}>
              FIFA #{RANK(team)}
            </div>
          </div>
        ))}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "Oswald",
              fontSize: 26,
              fontWeight: 700,
              color: T.accent,
            }}
          >
            {hg} — {ag2}
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>
            {winner ? `${FLAG(winner)} wins` : "Draw"}
          </div>
        </div>
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}
      >
        {[
          { label: match.home, val: odds.home, type: "home" },
          { label: "Draw", val: odds.draw, type: "draw" },
          { label: match.away, val: odds.away, type: "away" },
        ].map((o, i) => (
          <div
            key={i}
            style={{
              textAlign: "center",
              padding: "7px",
              background: pred === o.type ? `${T.accent}22` : T.surf2,
              border: `1px solid ${pred === o.type ? T.accent : T.border}`,
              borderRadius: 7,
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: T.muted,
                marginBottom: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {o.label}
            </div>
            <div
              style={{
                fontFamily: "Oswald",
                fontSize: 15,
                fontWeight: 700,
                color: pred === o.type ? T.accent : T.text,
              }}
            >
              {fmtOdds(o.val)}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          background: T.surf2,
          borderRadius: 9,
          padding: "11px 4px 4px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: T.muted,
            textAlign: "center",
            letterSpacing: 1,
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          GOAL FLOW PREDICTION
        </div>
        <ResponsiveContainer width="100%" height={145}>
          <LineChart
            data={chartData}
            margin={{ top: 4, right: 10, left: -24, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={T.dm ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"}
            />
            <XAxis
              dataKey="min"
              tick={{ fill: T.muted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, Math.max(hg, ag2, 1) + 0.6]}
              tick={{ fill: T.muted, fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              allowDecimals
            />
            <Tooltip content={<TTip />} />
            <Legend
              formatter={(v) => (
                <span
                  style={{
                    color: v === "h" ? T.accent : T.blue,
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {v === "h" ? match.home : match.away}
                </span>
              )}
            />
            <Line
              type="monotone"
              dataKey="h"
              name="h"
              stroke={T.accent}
              strokeWidth={2.5}
              dot={<Dot fill={T.accent} />}
              activeDot={{ r: 6, fill: T.accent }}
            />
            <Line
              type="monotone"
              dataKey="a"
              name="a"
              stroke={T.blue}
              strokeWidth={2.5}
              dot={<Dot fill={T.blue} />}
              activeDot={{ r: 6, fill: T.blue }}
              strokeDasharray="6 3"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {commOdds && commOdds.total_predictions > 0 && (
        <div
          style={{ background: T.surf2, borderRadius: 8, padding: "7px 11px" }}
        >
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 5 }}>
            Community ({commOdds.total_predictions} picks)
          </div>
          <div
            style={{
              display: "flex",
              height: 10,
              borderRadius: 5,
              overflow: "hidden",
              gap: 1,
            }}
          >
            <div
              style={{
                width: `${commOdds.home_pct}%`,
                background: T.accent,
                minWidth: 2,
              }}
            />
            <div
              style={{
                width: `${commOdds.draw_pct}%`,
                background: T.muted,
                minWidth: 2,
              }}
            />
            <div
              style={{
                width: `${commOdds.away_pct}%`,
                background: T.blue,
                minWidth: 2,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              marginTop: 3,
            }}
          >
            <span style={{ color: T.accent }}>
              {match.home} {commOdds.home_pct}%
            </span>
            <span style={{ color: T.muted }}>Draw {commOdds.draw_pct}%</span>
            <span style={{ color: T.blue }}>
              {match.away} {commOdds.away_pct}%
            </span>
          </div>
        </div>
      )}
      {!isLocked && (
        <>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
          >
            {[
              {
                team: match.home,
                g: hg,
                color: T.accent,
                set: (v) => handleSetHg(v),
              },
              {
                team: match.away,
                g: ag2,
                color: T.blue,
                set: (v) => handleSetAg2(v),
              },
            ].map((side, i) => (
              <div
                key={i}
                style={{
                  background: T.surf3,
                  borderRadius: 9,
                  padding: "9px 11px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 5,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <span style={{ fontSize: 15 }}>{FLAG(side.team)}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: side.color,
                      }}
                    >
                      {side.team}
                    </span>
                  </div>
                  <span
                    style={{
                      background: `${side.color}22`,
                      color: side.color,
                      borderRadius: 5,
                      padding: "1px 9px",
                      fontFamily: "Oswald",
                      fontSize: 16,
                      fontWeight: 700,
                    }}
                  >
                    {side.g}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={side.g}
                  onChange={(e) =>
                    !isLocked && side.set(Number(e.target.value))
                  }
                  disabled={isLocked}
                  style={{
                    accentColor: side.color,
                    opacity: isLocked ? 0.5 : 1,
                  }}
                />
                <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => !isLocked && side.set(n)}
                      disabled={isLocked}
                      style={{
                        flex: 1,
                        padding: "2px 0",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        background:
                          side.g === n ? side.color : `${side.color}18`,
                        color:
                          side.g === n ? (T.dm ? "#000" : "#fff") : side.color,
                        border: `1px solid ${side.g === n ? side.color : "transparent"}`,
                        transition: "all .12s",
                        opacity: isLocked ? 0.4 : 1,
                        cursor: isLocked ? "not-allowed" : "pointer",
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              minHeight: 36,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span
                className="chip"
                style={{
                  background: `${oddsInfo.color}22`,
                  color: oddsInfo.color,
                }}
              >
                {oddsInfo.label}
              </span>
              <span
                style={{
                  fontFamily: "Oswald",
                  fontSize: 17,
                  color: T.accent,
                  fontWeight: 700,
                }}
              >
                {fmtOdds(odds.selected)}
              </span>
              <span style={{ fontSize: 10, color: T.muted }}>
                → {fmtOdds(odds.selected * 10)} pts
              </span>
            </div>
            {/* Auto-save indicator + fallback Save button */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <SaveIndicator />
              <button
                onClick={async () => {
                  if (isLocked || saveStatus === SAVE_STATUS.saving) return;
                  setSaveStatus(SAVE_STATUS.saving);
                  await onSave(hg, ag2);
                  setSaveStatus(SAVE_STATUS.saved);
                }}
                disabled={isLocked || saveStatus === SAVE_STATUS.saving}
                style={{
                  background: isLocked
                    ? `${T.red}22`
                    : saveStatus === SAVE_STATUS.saved
                      ? `${T.green}22`
                      : T.accent,
                  color: isLocked
                    ? T.red
                    : saveStatus === SAVE_STATUS.saved
                      ? T.green
                      : "#000",
                  border: `1px solid ${isLocked ? T.red : saveStatus === SAVE_STATUS.saved ? T.green : "transparent"}`,
                  padding: "7px 16px",
                  borderRadius: 8,
                  fontFamily: "Oswald",
                  fontSize: 12,
                  fontWeight: 700,
                  opacity: isLocked
                    ? 0.5
                    : saveStatus === SAVE_STATUS.saving
                      ? 0.6
                      : 1,
                  transition: "all .25s",
                  whiteSpace: "nowrap",
                  cursor: isLocked ? "not-allowed" : "pointer",
                }}
              >
                {isLocked
                  ? "🔒 Locked"
                  : saveStatus === SAVE_STATUS.saving
                    ? "Saving…"
                    : saveStatus === SAVE_STATUS.saved
                      ? "✓ Saved"
                      : "Save"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AllStandings() {
  const { T, qual, groupQuals } = useU();
  const { allStandings = {} } = qual;
  const displayStandings = Object.entries(allStandings).reduce(
    (acc, [g, rows]) => {
      const picks = groupQuals[g];
      if (!picks?.first && !picks?.second) {
        acc[g] = rows;
        return acc;
      }
      const ordered = [];
      const seen = new Set();
      [picks?.first, picks?.second].filter(Boolean).forEach((team) => {
        const match = rows.find((row) => row.team === team);
        if (match && !seen.has(team)) {
          seen.add(team);
          ordered.push({ ...match, predictedQualifier: true });
        }
      });
      rows.forEach((row) => {
        if (!seen.has(row.team)) ordered.push(row);
      });
      acc[g] = ordered.map((row, index) => ({
        ...row,
        displayPosition: index + 1,
      }));
      return acc;
    },
    {},
  );
  return (
    <div className="fade-up">
      <h2
        style={{
          fontFamily: "Oswald",
          fontSize: 20,
          color: T.accent,
          marginBottom: 14,
        }}
      >
        All Group Standings
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
          gap: 14,
        }}
      >
        {Object.entries(allStandings).map(([g, rows]) => (
          <div
            key={g}
            style={{
              background: T.surf,
              border: `1px solid ${T.border}`,
              borderRadius: 11,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "9px 14px",
                background: T.surf2,
                borderBottom: `1px solid ${T.border}`,
                fontFamily: "Oswald",
                fontSize: 13,
                color: T.accent,
              }}
            >
              Group {g}
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 11,
              }}
            >
              <thead>
                <tr style={{ color: T.muted, fontSize: 10 }}>
                  {[
                    "#",
                    "Team",
                    "P",
                    "W",
                    "D",
                    "L",
                    "GF",
                    "GA",
                    "GD",
                    "Pts",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "5px 6px",
                        textAlign: h === "Team" ? "left" : "center",
                        borderBottom: `1px solid ${T.border}`,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(rows || []).map((row, i) => (
                  <tr
                    key={row.team}
                    style={{
                      background:
                        i < 2
                          ? `${T.accent}0d`
                          : i === 2
                            ? `${T.blue}0a`
                            : "transparent",
                    }}
                  >
                    <td
                      style={{
                        padding: "6px",
                        textAlign: "center",
                        fontWeight: 700,
                        color: i < 2 ? T.accent : i === 2 ? T.blue : T.muted,
                      }}
                    >
                      {row.displayPosition || i + 1}
                    </td>
                    <td style={{ padding: "6px" }}>
                      <span style={{ fontSize: 13 }}>{FLAG(row.team)}</span>
                      <span style={{ marginLeft: 4, fontWeight: 600 }}>
                        {row.team}
                      </span>
                      {(row.predictedQualifier || i < 2) && (
                        <span
                          className="chip"
                          style={{
                            marginLeft: 5,
                            background: `${T.green}22`,
                            color: T.green,
                          }}
                        >
                          Q
                        </span>
                      )}
                      {i === 2 && (
                        <span
                          className="chip"
                          style={{
                            marginLeft: 5,
                            background: `${T.blue}22`,
                            color: T.blue,
                          }}
                        >
                          T3
                        </span>
                      )}
                    </td>
                    {[row.p, row.w, row.d, row.l, row.gf, row.ga].map(
                      (v, vi) => (
                        <td
                          key={vi}
                          style={{ padding: "6px", textAlign: "center" }}
                        >
                          {v}
                        </td>
                      ),
                    )}
                    <td
                      style={{
                        padding: "6px",
                        textAlign: "center",
                        color:
                          row.gd > 0 ? T.green : row.gd < 0 ? T.red : T.text,
                      }}
                    >
                      {row.gd > 0 ? "+" : ""}
                      {row.gd}
                    </td>
                    <td
                      style={{
                        padding: "6px",
                        textAlign: "center",
                        fontWeight: 700,
                        color: T.accent,
                      }}
                    >
                      {row.pts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {Object.keys(allStandings).length === 0 && (
          <div
            style={{
              color: T.muted,
              padding: 30,
              gridColumn: "1/-1",
              textAlign: "center",
            }}
          >
            Predict group matches to see live standings.
          </div>
        )}
      </div>
    </div>
  );
}

function ThirdPlaceRace() {
  const { T, qual } = useU();
  const { thirdRows = [], qualified3 = [] } = qual;
  return (
    <div className="fade-up">
      <h2
        style={{
          fontFamily: "Oswald",
          fontSize: 20,
          color: T.accent,
          marginBottom: 6,
        }}
      >
        🥉 Third-Place Team Ranking
      </h2>
      <p style={{ color: T.muted, fontSize: 12, marginBottom: 16 }}>
        All 12 third-placed teams ranked together — top 8 by Points → GD → GF
        qualify for Round of 32 regardless of their group letter.
      </p>
      <div
        style={{
          background: T.surf,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            background: T.surf2,
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontFamily: "Oswald", fontSize: 13, color: T.accent }}>
            All 12 Third-Placed Teams
          </span>
          <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
            <span
              className="chip"
              style={{ background: `${T.green}22`, color: T.green }}
            >
              Top 8 → Qualify
            </span>
            <span
              className="chip"
              style={{ background: `${T.red}22`, color: T.red }}
            >
              Bottom 4 → Out
            </span>
          </div>
        </div>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}
        >
          <thead>
            <tr style={{ color: T.muted, fontSize: 10 }}>
              {[
                "Slot",
                "Grp",
                "Team",
                "P",
                "W",
                "D",
                "L",
                "GF",
                "GA",
                "GD",
                "Pts",
                "Status",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "6px 8px",
                    textAlign:
                      h === "Team" || h === "Grp" || h === "Status"
                        ? "left"
                        : "center",
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {thirdRows.map((row, i) => {
              const qualifies = i < 8;
              const badge = getThirdPlaceBadge(i + 1);
              return (
                <tr
                  key={row.team}
                  style={{
                    background: qualifies ? `${T.green}08` : `${T.red}08`,
                    borderBottom: `1px solid ${T.border}22`,
                  }}
                >
                  <td
                    style={{
                      padding: "8px",
                      textAlign: "center",
                      fontWeight: 700,
                      color: qualifies ? T.green : T.red,
                    }}
                  >
                    {qualifies ? `T3-${i + 1}` : "—"}
                  </td>
                  <td
                    style={{ padding: "8px", fontWeight: 600, color: T.accent }}
                  >
                    Grp {row.group}
                  </td>
                  <td style={{ padding: "8px" }}>
                    <span style={{ fontSize: 15 }}>{FLAG(row.team)}</span>
                    <span style={{ marginLeft: 5, fontWeight: 600 }}>
                      {row.team}
                    </span>
                  </td>
                  {[row.p, row.w, row.d, row.l, row.gf, row.ga].map((v, vi) => (
                    <td
                      key={vi}
                      style={{ padding: "8px", textAlign: "center" }}
                    >
                      {v}
                    </td>
                  ))}
                  <td
                    style={{
                      padding: "8px",
                      textAlign: "center",
                      color: row.gd > 0 ? T.green : row.gd < 0 ? T.red : T.text,
                    }}
                  >
                    {row.gd > 0 ? "+" : ""}
                    {row.gd}
                  </td>
                  <td
                    style={{
                      padding: "8px",
                      textAlign: "center",
                      fontWeight: 700,
                      color: T.accent,
                    }}
                  >
                    {row.pts}
                  </td>
                  <td style={{ padding: "8px" }}>
                    <span
                      className="chip"
                      style={{
                        background: `${badge.color}22`,
                        color: badge.color,
                      }}
                    >
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {thirdRows.length === 0 && (
              <tr>
                <td
                  colSpan={12}
                  style={{ padding: 30, textAlign: "center", color: T.muted }}
                >
                  Predict group matches to see third-place rankings
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {qualified3.length > 0 && (
        <div
          style={{
            background: T.surf,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div
            style={{
              fontFamily: "Oswald",
              fontSize: 14,
              color: T.green,
              marginBottom: 12,
            }}
          >
            ✅ Qualified Third-Placed Teams
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
              gap: 8,
            }}
          >
            {qualified3.map((row, i) => (
              <div
                key={row.team}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: T.surf2,
                  borderRadius: 8,
                  border: `1px solid ${T.green}44`,
                }}
              >
                <span
                  style={{
                    fontFamily: "Oswald",
                    fontSize: 11,
                    color: T.green,
                    minWidth: 28,
                  }}
                >
                  T3-{i + 1}
                </span>
                <span style={{ fontSize: 18 }}>{FLAG(row.team)}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {row.team}
                  </div>
                  <div style={{ fontSize: 10, color: T.muted }}>
                    Grp {row.group} · {row.pts}pts · GD{row.gd > 0 ? "+" : ""}
                    {row.gd}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KnockoutView({ stage, title, bracket }) {
  const { T, qual, knockouts, sfLosers, saveKO, resolve } = useU();
  const cols = stage === "r32" ? 4 : stage === "r16" ? 4 : 2;
  const done = bracket.filter((_, i) => knockouts[`${stage}-${i}`]).length;
  return (
    <div className="fade-up">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <h2 style={{ fontFamily: "Oswald", fontSize: 20, color: T.accent }}>
          {title}
        </h2>
        <span style={{ fontSize: 11, color: T.muted }}>
          {done}/{bracket.length} decided
        </span>
      </div>
      {stage === "r32" && (
        <div
          style={{
            background: `${T.blue}12`,
            border: `1px solid ${T.blue}33`,
            borderRadius: 9,
            padding: "9px 14px",
            marginBottom: 14,
            fontSize: 12,
            color: T.text,
          }}
        >
          📌 Matches 1–12: Group Winners vs Runners-Up · Matches 13–16: Best 8
          Third-Placed Teams paired (T3-1 vs T3-2, T3-3 vs T3-4, T3-5 vs T3-6,
          T3-7 vs T3-8)
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols},1fr)`,
          gap: 11,
        }}
      >
        {bracket.map((slot, i) => {
          const home = resolve(slot.homeSlot),
            away = resolve(slot.awaySlot),
            winner = knockouts[`${stage}-${i}`];
          const tbd = home === "TBD" || away === "TBD";
          const odds = !tbd
            ? calculateMatchOdds(home, away, "home", stage)
            : null;
          return (
            <div
              key={slot.id}
              className="card-hover"
              style={{
                background: T.surf,
                border: `1px solid ${winner ? `${T.accent}55` : T.border}`,
                borderRadius: 11,
                padding: 11,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: T.muted,
                  marginBottom: 5,
                  textAlign: "center",
                  fontWeight: 700,
                  letterSpacing: 1,
                }}
              >
                {slot.id}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: T.muted,
                  textAlign: "center",
                  marginBottom: 8,
                }}
              >
                📅 {slot.date} · {slot.time} ·{" "}
                {VENUES[slot.venue] || slot.venue}
              </div>
              {slot.homeSlot?.startsWith("T3_") && (
                <div style={{ textAlign: "center", marginBottom: 5 }}>
                  <span
                    className="chip"
                    style={{ background: `${T.blue}22`, color: T.blue }}
                  >
                    3rd-place qualifier
                  </span>
                </div>
              )}
              {[{ team: home }, { team: away }].map(({ team }, ti) => (
                <div
                  key={ti}
                  className={`team-btn${winner === team ? " winner-glow" : ""}`}
                  onClick={() =>
                    team !== "TBD" && !tbd && saveKO(stage, i, team)
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 9px",
                    borderRadius: 7,
                    marginBottom: 5,
                    background: winner === team ? `${T.accent}1f` : T.surf2,
                    border: `1px solid ${winner === team ? T.accent : T.border}`,
                    opacity: winner && winner !== team ? 0.4 : 1,
                    cursor: tbd ? "default" : "pointer",
                  }}
                >
                  <span style={{ fontSize: 20 }}>{FLAG(team)}</span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: winner === team ? T.accent : T.text,
                      }}
                    >
                      {team}
                    </div>
                    <div style={{ fontSize: 9, color: T.muted }}>
                      FIFA #{RANK(team)}
                    </div>
                  </div>
                  {winner === team && (
                    <span style={{ color: T.green, fontSize: 13 }}>✓</span>
                  )}
                </div>
              ))}
              {odds && !winner && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 4,
                    marginTop: 4,
                  }}
                >
                  <div
                    style={{
                      textAlign: "center",
                      padding: "3px",
                      background: T.surf2,
                      borderRadius: 5,
                      fontSize: 10,
                      color: T.muted,
                    }}
                  >
                    {home.split(" ")[0]}:{" "}
                    <strong style={{ color: T.accent }}>
                      {fmtOdds(odds.home)}
                    </strong>
                  </div>
                  <div
                    style={{
                      textAlign: "center",
                      padding: "3px",
                      background: T.surf2,
                      borderRadius: 5,
                      fontSize: 10,
                      color: T.muted,
                    }}
                  >
                    {away.split(" ")[0]}:{" "}
                    <strong style={{ color: T.blue }}>
                      {fmtOdds(odds.away)}
                    </strong>
                  </div>
                </div>
              )}
              {winner && (
                <div
                  style={{
                    textAlign: "center",
                    fontSize: 10,
                    color: T.green,
                    fontWeight: 600,
                    marginTop: 4,
                  }}
                >
                  {FLAG(winner)} {winner} advances
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThirdPlaceMatchView() {
  const { T, knockouts, sfLosers, saveKO } = useU();
  const home = sfLosers["sf-0"] || "TBD",
    away = sfLosers["sf-1"] || "TBD",
    winner = knockouts["tp-0"];
  if (!knockouts["sf-0"] || !knockouts["sf-1"])
    return (
      <LockedMsg
        msg="Predict both Semi Finals to unlock the 3rd Place Match."
        T={T}
      />
    );
  return (
    <div className="fade-up" style={{ maxWidth: 540, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 48 }}>🥉</div>
        <h1
          style={{
            fontFamily: "Oswald",
            fontSize: 30,
            color: T.accent,
            letterSpacing: 2,
          }}
        >
          3RD PLACE MATCH
        </h1>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>
          📅 Jul 19, 2026 · 14:00 ET · SoFi Stadium, CA
        </div>
      </div>
      <div
        style={{
          background: T.surf,
          border: `1px solid ${T.border}`,
          borderRadius: 13,
          padding: 22,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            gap: 12,
            alignItems: "center",
          }}
        >
          {[home, away].map((team, ti) => (
            <div
              key={ti}
              className={`team-btn${winner === team ? " celebrate" : ""}`}
              onClick={() => team !== "TBD" && saveKO("tp", 0, team)}
              style={{
                textAlign: "center",
                padding: 16,
                borderRadius: 11,
                cursor: team === "TBD" ? "default" : "pointer",
                background: winner === team ? `${T.accent}2a` : T.surf2,
                border: `2px solid ${winner === team ? T.accent : T.border}`,
                transition: "all .3s",
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 7 }}>{FLAG(team)}</div>
              <div
                style={{
                  fontFamily: "Oswald",
                  fontSize: 15,
                  fontWeight: 700,
                  color: winner === team ? T.accent : T.text,
                }}
              >
                {team}
              </div>
              {winner === team && (
                <div style={{ fontSize: 18, marginTop: 5 }}>🥉</div>
              )}
            </div>
          ))}
          <div
            style={{
              textAlign: "center",
              fontFamily: "Oswald",
              fontSize: 20,
              color: T.accent,
              fontWeight: 700,
            }}
          >
            VS
          </div>
        </div>
        {winner && (
          <div
            style={{
              textAlign: "center",
              marginTop: 14,
              padding: "8px",
              background: `${T.accent}18`,
              borderRadius: 8,
              fontSize: 13,
              color: T.accent,
              fontWeight: 700,
            }}
          >
            🥉 {FLAG(winner)} {winner} — 3rd Place!
          </div>
        )}
        {!winner && (
          <p
            style={{
              textAlign: "center",
              color: T.muted,
              fontSize: 11,
              marginTop: 12,
            }}
          >
            Click to pick the 3rd place team
          </p>
        )}
      </div>
    </div>
  );
}

function FinalView() {
  const { T, knockouts, saveKO } = useU();
  const home = knockouts["sf-0"] || "TBD",
    away = knockouts["sf-1"] || "TBD",
    champion = knockouts["final-0"];
  if (!knockouts["sf-0"] || !knockouts["sf-1"])
    return (
      <LockedMsg msg="Predict both Semi Finals to unlock The Final." T={T} />
    );
  return (
    <div className="fade-up" style={{ maxWidth: 540, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ fontSize: 52 }}>🏆</div>
        <h1
          style={{
            fontFamily: "Oswald",
            fontSize: 34,
            color: T.accent,
            letterSpacing: 2,
          }}
        >
          THE FINAL
        </h1>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>
          📅 Jul 19, 2026 · 19:00 ET · MetLife Stadium, NJ
        </div>
      </div>
      <div
        style={{
          background: T.surf,
          border: `1px solid ${T.accent}44`,
          borderRadius: 13,
          padding: 24,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            gap: 14,
            alignItems: "center",
          }}
        >
          {[home, away].map((team, ti) => (
            <div
              key={ti}
              className={`team-btn${champion === team ? " celebrate" : ""}`}
              onClick={() => team !== "TBD" && saveKO("final", 0, team)}
              style={{
                textAlign: "center",
                padding: 18,
                borderRadius: 11,
                cursor: team === "TBD" ? "default" : "pointer",
                background: champion === team ? `${T.accent}2a` : T.surf2,
                border: `2px solid ${champion === team ? T.accent : T.border}`,
                transition: "all .3s",
              }}
            >
              <div style={{ fontSize: 56, marginBottom: 7 }}>{FLAG(team)}</div>
              <div
                style={{
                  fontFamily: "Oswald",
                  fontSize: 15,
                  fontWeight: 700,
                  color: champion === team ? T.accent : T.text,
                }}
              >
                {team}
              </div>
              <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>
                FIFA #{RANK(team)}
              </div>
              {champion === team && (
                <div style={{ fontSize: 22, marginTop: 6 }}>🏆</div>
              )}
            </div>
          ))}
          <div
            style={{
              textAlign: "center",
              fontFamily: "Oswald",
              fontSize: 22,
              color: T.accent,
              fontWeight: 700,
            }}
          >
            VS
          </div>
        </div>
        {champion && (
          <div
            style={{
              textAlign: "center",
              marginTop: 16,
              padding: "10px",
              background: `${T.accent}18`,
              borderRadius: 9,
              fontSize: 13,
              color: T.accent,
              fontWeight: 700,
            }}
          >
            🏆 {FLAG(champion)} {champion} is your predicted World Champion
            2026!
          </div>
        )}
        {!champion && (
          <p
            style={{
              textAlign: "center",
              color: T.muted,
              fontSize: 11,
              marginTop: 14,
            }}
          >
            Click a team to crown your World Champion
          </p>
        )}
      </div>
    </div>
  );
}

function FullBracket() {
  const { T, qual, knockouts, sfLosers } = useU();
  const resolve = (slot) => resolveSlot(slot, qual, knockouts, sfLosers);
  const Pill = ({ slot, isW }) => {
    const team = resolve(slot);
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 6px",
          background: isW ? `${T.accent}1f` : T.surf2,
          borderRadius: 4,
          border: `0.5px solid ${isW ? T.accent : T.border}`,
          marginBottom: 2,
          minWidth: 115,
        }}
      >
        <span style={{ fontSize: 11 }}>{FLAG(team)}</span>
        <span
          style={{
            fontSize: 9,
            fontWeight: isW ? 700 : 400,
            color: isW ? T.accent : T.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 85,
          }}
        >
          {team}
        </span>
      </div>
    );
  };
  const stages = [
    { label: "Round of 32", bracket: R32_BRACKET, stageKey: "r32" },
    { label: "Round of 16", bracket: R16_BRACKET, stageKey: "r16" },
    { label: "QF", bracket: QF_BRACKET, stageKey: "qf" },
    { label: "SF", bracket: SF_BRACKET, stageKey: "sf" },
  ];
  const champion = knockouts["final-0"],
    sf1W = knockouts["sf-0"],
    sf2W = knockouts["sf-1"];
  return (
    <div className="fade-up">
      <h2
        style={{
          fontFamily: "Oswald",
          fontSize: 20,
          color: T.accent,
          marginBottom: 14,
        }}
      >
        🌐 Full Tournament Bracket
      </h2>
      <div style={{ overflowX: "auto", paddingBottom: 10 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            minWidth: 1040,
            alignItems: "flex-start",
          }}
        >
          {stages.map((s) => (
            <div key={s.label} style={{ flex: 1, minWidth: 130 }}>
              <div
                style={{
                  textAlign: "center",
                  fontFamily: "Oswald",
                  fontSize: 11,
                  color: T.accent,
                  marginBottom: 7,
                  borderBottom: `1px solid ${T.border}`,
                  paddingBottom: 4,
                }}
              >
                {s.label}
              </div>
              {s.bracket.map((slot, i) => {
                const w = knockouts[`${s.stageKey}-${i}`];
                const ht = resolve(slot.homeSlot),
                  at = resolve(slot.awaySlot);
                return (
                  <div
                    key={slot.id}
                    style={{
                      marginBottom: 7,
                      padding: 5,
                      background: T.surf,
                      borderRadius: 6,
                      border: `1px solid ${w ? `${T.accent}40` : T.border}`,
                    }}
                  >
                    <Pill slot={slot.homeSlot} isW={!!w && w === ht} />
                    <Pill slot={slot.awaySlot} isW={!!w && w === at} />
                    {w && (
                      <div
                        style={{
                          fontSize: 8,
                          color: T.green,
                          textAlign: "center",
                          marginTop: 2,
                        }}
                      >
                        ✓ {w}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ flex: 1, minWidth: 130 }}>
            <div
              style={{
                textAlign: "center",
                fontFamily: "Oswald",
                fontSize: 11,
                color: T.accent,
                marginBottom: 7,
                borderBottom: `1px solid ${T.border}`,
                paddingBottom: 4,
              }}
            >
              FINAL
            </div>
            <div
              style={{
                padding: 5,
                background: T.surf,
                borderRadius: 6,
                border: `1px solid ${T.accent}55`,
                marginBottom: 7,
              }}
            >
              {[sf1W || "TBD", sf2W || "TBD"].map((team, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 6px",
                    background: champion === team ? `${T.accent}1f` : T.surf2,
                    borderRadius: 4,
                    border: `0.5px solid ${champion === team ? T.accent : T.border}`,
                    marginBottom: 2,
                  }}
                >
                  <span style={{ fontSize: 11 }}>{FLAG(team)}</span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: champion === team ? 700 : 400,
                      color: champion === team ? T.accent : T.text,
                    }}
                  >
                    {team}
                  </span>
                </div>
              ))}
              {champion && (
                <div
                  style={{
                    textAlign: "center",
                    marginTop: 7,
                    padding: 5,
                    background: `${T.accent}1a`,
                    border: `1px solid ${T.accent}`,
                    borderRadius: 5,
                  }}
                >
                  <div style={{ fontSize: 18 }}>{FLAG(champion)}</div>
                  <div
                    style={{ fontSize: 10, fontWeight: 700, color: T.accent }}
                  >
                    {champion}
                  </div>
                  <div style={{ fontSize: 8, color: "#fbbf24" }}>
                    🏆 CHAMPION 2026
                  </div>
                </div>
              )}
            </div>
            <div
              style={{
                textAlign: "center",
                fontFamily: "Oswald",
                fontSize: 11,
                color: T.muted,
                marginBottom: 5,
                borderBottom: `1px solid ${T.border}`,
                paddingBottom: 4,
              }}
            >
              3RD PLACE
            </div>
            <div
              style={{
                padding: 5,
                background: T.surf,
                borderRadius: 6,
                border: `1px solid ${T.border}`,
              }}
            >
              {[sfLosers["sf-0"] || "TBD", sfLosers["sf-1"] || "TBD"].map(
                (team, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 6px",
                      background:
                        knockouts["tp-0"] === team ? `${T.blue}1f` : T.surf2,
                      borderRadius: 4,
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ fontSize: 11 }}>{FLAG(team)}</span>
                    <span style={{ fontSize: 9, color: T.muted }}>{team}</span>
                  </div>
                ),
              )}
              {knockouts["tp-0"] && (
                <div
                  style={{
                    textAlign: "center",
                    fontSize: 8,
                    color: T.blue,
                    marginTop: 4,
                  }}
                >
                  🥉 {knockouts["tp-0"]}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 20,
          background: T.surf,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h3
          style={{
            fontFamily: "Oswald",
            fontSize: 15,
            color: T.accent,
            marginBottom: 12,
          }}
        >
          Group Qualification Summary
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))",
            gap: 8,
          }}
        >
          {Object.entries(GROUPS).map(([g]) => {
            const w = qual.winners?.[g] || "TBD",
              r = qual.runnersUp?.[g] || "TBD",
              t3 = qual.thirds?.[g];
            const t3rank = qual.thirdRows?.findIndex(
              (row) => row.team === t3?.team,
            );
            const t3q = t3rank >= 0 && t3rank < 8;
            return (
              <div
                key={g}
                style={{
                  background: T.surf2,
                  borderRadius: 8,
                  padding: "8px 11px",
                  border: `1px solid ${T.border}`,
                }}
              >
                <div
                  style={{
                    fontFamily: "Oswald",
                    fontSize: 12,
                    color: T.accent,
                    marginBottom: 6,
                  }}
                >
                  Group {g}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginBottom: 3,
                  }}
                >
                  <span
                    className="chip"
                    style={{ background: `${T.green}22`, color: T.green }}
                  >
                    1st
                  </span>
                  <span style={{ fontSize: 12 }}>{FLAG(w)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{w}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginBottom: 3,
                  }}
                >
                  <span
                    className="chip"
                    style={{ background: `${T.blue}22`, color: T.blue }}
                  >
                    2nd
                  </span>
                  <span style={{ fontSize: 12 }}>{FLAG(r)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{r}</span>
                </div>
                {t3 && (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <span
                      className="chip"
                      style={{
                        background: t3q ? `${T.orange}22` : `${T.muted}22`,
                        color: t3q ? T.orange : T.muted,
                      }}
                    >
                      3rd
                    </span>
                    <span style={{ fontSize: 12 }}>{FLAG(t3.team)}</span>
                    <span
                      style={{ fontSize: 10, color: t3q ? T.orange : T.muted }}
                    >
                      {t3.team}
                      {t3q ? " ✓" : " ✗"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 50;

function LeaderboardView() {
  const { T, leaderboard, profile } = useU();
  const medals = ["🥇", "🥈", "🥉"];

  const [players, setPlayers]     = useState([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(0);
  const [search, setSearch]       = useState("");
  const [loadingP, setLoadingP]   = useState(false);
  const [draftSearch, setDraft]   = useState("");
  const searchTimer               = useRef(null);

  // My rank is always from the context leaderboard (full top-100 already loaded)
  const myEntry = leaderboard.find((u) => u.id === profile?.id);
  const myRank  = myEntry?.rank ?? null;

  const loadPlayers = async (p, q) => {
    setLoadingP(true);
    const { data, count, error } = await getPlayers({ page: p, limit: PAGE_SIZE, search: q });
    if (!error) {
      setPlayers(p === 0 ? (data || []) : (prev) => [...prev, ...(data || [])]);
      setTotal(count ?? 0);
    }
    setLoadingP(false);
  };

  // Initial load + reload on search
  useEffect(() => {
    setPage(0);
    loadPlayers(0, search);
  }, [search]);

  const handleSearchChange = (val) => {
    setDraft(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 350);
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    loadPlayers(next, search);
  };

  const hasMore = players.length < total;
  const headers = ["Rank", "Player", "Country", "Points", "Accuracy %", "Exact", "Correct", "Total", "Won", "Lost"];

  return (
    <div className="fade-up">
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontFamily: "Oswald", fontSize: 20, color: T.accent }}>
          🏅 Global Leaderboard
        </h2>
        {myEntry && (
          <div style={{ background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 8, padding: "6px 12px", fontSize: 12, color: T.accent, fontFamily: "Oswald" }}>
            Your rank: #{myRank} · {myEntry.total_points} pts
          </div>
        )}
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: 12 }}>
        <input
          value={draftSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by username or country…"
          style={{
            width: "100%",
            padding: "9px 14px",
            background: T.surf,
            border: `1px solid ${T.border}`,
            borderRadius: 9,
            color: T.text,
            fontSize: 13,
            outline: "none",
          }}
        />
      </div>

      {/* Stats summary */}
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
        {search ? `${total} result${total !== 1 ? "s" : ""} for "${search}"` : `${total.toLocaleString()} registered player${total !== 1 ? "s" : ""}`}
        {" · "}showing {players.length}
      </div>

      <div style={{ background: T.surf, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 700 }}>
          <thead>
            <tr style={{ background: T.surf2 }}>
              {headers.map((h) => (
                <th key={h} style={{ padding: "10px 10px", textAlign: "left", fontSize: 11, color: T.muted, fontWeight: 700, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((u, i) => {
              const isMe = u.id === profile?.id;
              const absRank = u.rank ?? (page * PAGE_SIZE + i + 1);
              return (
                <tr
                  key={u.id}
                  style={{
                    background: isMe ? `${T.accent}10` : i % 2 === 0 ? "transparent" : T.surf2,
                    borderBottom: `1px solid ${T.border}33`,
                  }}
                >
                  <td style={{ padding: "9px 10px", fontWeight: 700, color: absRank <= 3 ? T.accent : T.text, whiteSpace: "nowrap" }}>
                    {absRank <= 3 && !search ? medals[absRank - 1] : `#${absRank}`}
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ width: 26, height: 26, borderRadius: "50%", background: `${T.accent}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: T.accent, flexShrink: 0 }}>
                        {u.username[0].toUpperCase()}
                      </div>
                      <span style={{ fontWeight: isMe ? 700 : 600, color: isMe ? T.accent : T.text, whiteSpace: "nowrap" }}>
                        {u.username}{isMe ? " (you)" : ""}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "9px 10px", color: T.muted, whiteSpace: "nowrap" }}>{u.country || "—"}</td>
                  <td style={{ padding: "9px 10px", fontFamily: "Oswald", fontSize: 16, fontWeight: 700, color: T.accent }}>{u.total_points}</td>
                  <td style={{ padding: "9px 10px", color: T.green, whiteSpace: "nowrap" }}>{u.accuracy_pct ?? 0}%</td>
                  <td style={{ padding: "9px 10px" }}>
                    <span style={{ background: `${T.accent}22`, color: T.accent, borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 700 }}>{u.exact_predictions || 0}</span>
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    <span style={{ background: `${T.green}22`, color: T.green, borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 700 }}>{u.correct_predictions || 0}</span>
                  </td>
                  <td style={{ padding: "9px 10px", color: T.text }}>{u.total_predictions || 0}</td>
                  <td style={{ padding: "9px 10px", color: T.green, fontWeight: 600 }}>{u.predictions_won || 0}</td>
                  <td style={{ padding: "9px 10px", color: T.red, fontWeight: 600 }}>{u.predictions_lost || 0}</td>
                </tr>
              );
            })}
            {players.length === 0 && !loadingP && (
              <tr>
                <td colSpan={10} style={{ padding: 40, textAlign: "center", color: T.muted }}>
                  {search ? `No players found for "${search}"` : "No players registered yet — be the first!"}
                </td>
              </tr>
            )}
            {loadingP && (
              <tr>
                <td colSpan={10} style={{ padding: 20, textAlign: "center", color: T.muted, fontSize: 12 }}>
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && !loadingP && (
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button
            onClick={loadMore}
            style={{ background: T.surf, border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 24px", color: T.accent, fontFamily: "Oswald", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            Load more ({total - players.length} remaining)
          </button>
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 10, fontSize: 11, color: T.muted }}>
        Top-100 leaderboard refreshes every 60 seconds
      </div>
    </div>
  );
}

function MyPredictions() {
  const { T, matchPreds, knockouts, profile, leaderboard } = useU();
  const preds = Object.values(matchPreds);

  const scored   = preds.filter((p) => p.result_status != null);
  const exact    = scored.filter((p) => p.result_status === "exact").length;
  const correct  = scored.filter((p) => p.result_status === "correct").length;
  const wrong    = scored.filter((p) => p.result_status === "wrong").length;
  const totalPts = scored.reduce((s, p) => s + (p.points_earned || 0), 0);
  const accuracy = scored.length > 0 ? Math.round(((exact + correct) / scored.length) * 100) : 0;
  const myRank   = leaderboard.findIndex((u) => u.id === profile?.id) + 1;

  const allFix = Object.values(GF).flat();

  const RESULT_COLOR = { exact: T.accent, correct: T.green, wrong: T.red, pending: T.muted };
  const RESULT_LABEL = { exact: "Exact +10pts", correct: "Correct +5pts", wrong: "Wrong", pending: "Pending" };

  const stats = [
    { icon: "⚽", label: "Match Preds", val: `${preds.length}/72`,   color: T.accent },
    { icon: "🏆", label: "Total Points", val: `${profile?.total_points ?? totalPts} pts`, color: T.accent },
    { icon: "🌍", label: "World Rank",  val: myRank ? `#${myRank}` : "—", color: T.orange },
    { icon: "🎯", label: "Exact Scores", val: exact,                  color: T.accent },
    { icon: "✅", label: "Correct",      val: correct,                color: T.green },
    { icon: "❌", label: "Wrong",        val: wrong,                  color: T.red },
    { icon: "📊", label: "Accuracy",    val: `${accuracy}%`,          color: T.green },
    { icon: "🔮", label: "KO Picks",    val: Object.keys(knockouts).length, color: T.purple },
  ];

  return (
    <div className="fade-up">
      <h2 style={{ fontFamily: "Oswald", fontSize: 20, color: T.accent, marginBottom: 14 }}>
        📋 My Predictions
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, marginBottom: 18 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ background: T.surf, border: `1px solid ${T.border}`, borderRadius: 11, padding: "12px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontFamily: "Oswald", fontSize: 17, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: T.surf, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", background: T.surf2, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "Oswald", fontSize: 13, color: T.accent }}>All Match Predictions</span>
          <span style={{ fontSize: 11, color: T.muted }}>{scored.length} scored · {preds.length - scored.length} pending</span>
        </div>
        {preds.length === 0 && (
          <div style={{ padding: 30, textAlign: "center", color: T.muted, fontSize: 13 }}>
            No predictions yet — head to Group Stage to start!
          </div>
        )}
        {preds
          .slice()
          .sort((a, b) => {
            // Scored first (exact > correct > wrong), then pending
            const order = { exact: 0, correct: 1, wrong: 2, null: 3, undefined: 3 };
            return (order[a.result_status] ?? 3) - (order[b.result_status] ?? 3);
          })
          .map((p) => {
            const fix = allFix.find((f) => f.id === p.match_id);
            const rs = p.result_status;
            const rc = RESULT_COLOR[rs] || T.muted;
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 14px",
                  borderBottom: `1px solid ${T.border}22`,
                  fontSize: 12,
                  borderLeft: rs ? `3px solid ${rc}` : `3px solid transparent`,
                }}
              >
                <span style={{ fontSize: 15 }}>{FLAG(fix?.home || "TBD")}</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 12 }}>{fix?.home || p.match_id}</span>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "Oswald", fontSize: 14, color: T.accent, fontWeight: 700, lineHeight: 1 }}>
                    {p.predicted_home_score}–{p.predicted_away_score}
                  </div>
                  {fix && p.result_status && (
                    <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>
                      actual: {fix ? (Object.values(matchPreds).find(m => m.match_id === fix.id) ? "" : "") : ""}
                    </div>
                  )}
                </div>
                <span style={{ flex: 1, fontWeight: 600, textAlign: "right", fontSize: 12 }}>{fix?.away || ""}</span>
                <span style={{ fontSize: 15 }}>{FLAG(fix?.away || "TBD")}</span>
                {rs ? (
                  <div style={{ textAlign: "right", minWidth: 80 }}>
                    <span style={{
                      display: "inline-block",
                      background: `${rc}20`,
                      color: rc,
                      borderRadius: 5,
                      padding: "2px 7px",
                      fontSize: 10,
                      fontWeight: 700,
                    }}>
                      {RESULT_LABEL[rs] || rs}
                    </span>
                  </div>
                ) : (
                  <span style={{ color: T.muted, fontSize: 10, minWidth: 80, textAlign: "right" }}>
                    {p.is_locked ? "🔒 Locked" : "⏳ Pending"}
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function AdminApp({ T, dark, setDark }) {
  const { profile } = useAuth();
  const [view, setView] = useState("overview");
  const [users, setUsers] = useState([]);
  const [selUser, setSelUser] = useState(null);
  const [userPreds, setUserP] = useState([]);
  const [auditLog, setAudit] = useState([]);
  const [allPreds, setAllPreds] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    adminGetAllUsers().then(({ data }) => setUsers(data || []));
    adminGetAuditLog(300).then(({ data }) => setAudit(data || []));
    adminGetAllPredictions().then(({ data }) => setAllPreds(data || []));
  }, []);
  const loadUserPreds = async (uid) => {
    setLoading(true);
    const { data } = await adminGetUserPredictions(uid);
    setUserP(data || []);
    setLoading(false);
  };
  const nav = [
    { id: "overview", icon: "📊", label: "Overview" },
    { id: "users", icon: "👥", label: "All Users" },
    { id: "preds", icon: "⚽", label: "All Predictions" },
    { id: "audit", icon: "📋", label: "Audit Log" },
  ];
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: T.bg,
        fontFamily: "Rajdhani,sans-serif",
        color: T.text,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Oswald:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <GS T={T} />
      <aside
        style={{
          width: 220,
          minWidth: 220,
          background: T.dm ? "#06090f" : "#111827",
          borderRight: `1px solid ${T.border}`,
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: "13px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          <span style={{ fontSize: 22 }}>🛡️</span>
          <div>
            <div
              style={{
                fontFamily: "Oswald",
                fontSize: 13,
                fontWeight: 700,
                color: "#ef4444",
                letterSpacing: 1,
              }}
            >
              ADMIN PANEL
            </div>
            <div style={{ fontSize: 10, color: T.muted }}>Read-Only Access</div>
          </div>
        </div>
        <div style={{ flex: 1, padding: "5px 0" }}>
          {nav.map((item) => (
            <div
              key={item.id}
              onClick={() => setView(item.id)}
              className={`nav-item${view === item.id ? " active" : ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 14px",
                borderLeft: "3px solid transparent",
                cursor: "pointer",
                color: view === item.id ? T.accent : T.text,
              }}
            >
              <span
                style={{
                  fontSize: 17,
                  color: view === item.id ? T.accent : T.muted,
                }}
              >
                {item.icon}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            padding: "9px",
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          <button
            onClick={() => setDark(!dark)}
            style={{
              background: T.surf2,
              color: T.text,
              borderRadius: 7,
              padding: "6px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {dark ? "☀️ Light" : "🌙 Dark"}
          </button>
          <button
            onClick={() => signOut()}
            style={{
              background: "#7f1d1d33",
              color: "#ef4444",
              borderRadius: 7,
              padding: "6px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Sign Out
          </button>
        </div>
      </aside>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <header
          style={{
            background: T.dm ? "#06090f" : "#111827",
            borderBottom: `1px solid ${T.border}`,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: "Oswald",
              fontSize: 17,
              fontWeight: 700,
              color: "white",
            }}
          >
            {nav.find((n) => n.id === view)?.icon}{" "}
            {nav.find((n) => n.id === view)?.label}
          </span>
          <div
            style={{
              marginLeft: "auto",
              background: "#ef444422",
              border: "1px solid #ef444444",
              borderRadius: 20,
              padding: "3px 12px",
              fontSize: 11,
              fontWeight: 700,
              color: "#ef4444",
            }}
          >
            🛡️ READ-ONLY
          </div>
        </header>
        <main style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {view === "overview" && (
            <div className="fade-up">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                {[
                  {
                    icon: "👥",
                    label: "Users",
                    val: users.length,
                    color: T.blue,
                  },
                  {
                    icon: "⚽",
                    label: "Predictions",
                    val: allPreds.length,
                    color: T.accent,
                  },
                  {
                    icon: "🔒",
                    label: "Locked",
                    val: allPreds.filter((p) => p.is_locked).length,
                    color: T.red,
                  },
                  {
                    icon: "🎯",
                    label: "Exact Scores",
                    val: allPreds.filter((p) => p.result_status === "exact")
                      .length,
                    color: T.green,
                  },
                  {
                    icon: "📋",
                    label: "Audit Events",
                    val: auditLog.length,
                    color: T.purple,
                  },
                ].map((s, i) => (
                  <div
                    key={i}
                    style={{
                      background: T.surf,
                      border: `1px solid ${T.border}`,
                      borderRadius: 11,
                      padding: "13px 10px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 4 }}>
                      {s.icon}
                    </div>
                    <div
                      style={{
                        fontFamily: "Oswald",
                        fontSize: 20,
                        fontWeight: 700,
                        color: s.color,
                      }}
                    >
                      {s.val}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  background: `${T.red}12`,
                  border: `1px solid ${T.red}33`,
                  borderRadius: 10,
                  padding: "13px 16px",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    fontFamily: "Oswald",
                    fontSize: 14,
                    color: T.red,
                    marginBottom: 5,
                  }}
                >
                  🛡️ Data Protection
                </div>
                <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
                  Admins have <strong>read-only</strong> access. Predictions
                  cannot be edited or deleted by anyone. Supabase RLS policies
                  enforce immutability at the infrastructure level. All changes
                  are permanently recorded in the audit log.
                </div>
              </div>
              <div
                style={{
                  background: T.surf,
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    background: T.surf2,
                    borderBottom: `1px solid ${T.border}`,
                    fontFamily: "Oswald",
                    fontSize: 13,
                    color: T.accent,
                  }}
                >
                  Recent Predictions
                </div>
                {allPreds.slice(0, 20).map((p, i) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "8px 14px",
                      borderBottom: `1px solid ${T.border}22`,
                      fontSize: 11,
                    }}
                  >
                    <span
                      style={{ color: T.blue, fontWeight: 600, minWidth: 80 }}
                    >
                      {p.profiles?.username}
                    </span>
                    <span style={{ color: T.muted, minWidth: 55 }}>
                      {p.match_id}
                    </span>
                    <span
                      style={{
                        fontFamily: "Oswald",
                        color: T.accent,
                        fontWeight: 700,
                      }}
                    >
                      {p.predicted_home_score}–{p.predicted_away_score}
                    </span>
                    <span style={{ color: T.muted, flex: 1 }}>
                      {fmtOdds(p.odds_at_submission)}
                    </span>
                    {p.is_locked ? (
                      <span style={{ color: T.red, fontSize: 10 }}>🔒</span>
                    ) : (
                      <span style={{ color: T.green, fontSize: 10 }}>✓</span>
                    )}
                    <span style={{ color: T.muted, fontSize: 10 }}>
                      {new Date(p.submitted_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {view === "users" && (
            <div
              className="fade-up"
              style={{
                display: "grid",
                gridTemplateColumns: "260px 1fr",
                gap: 16,
              }}
            >
              <div
                style={{
                  background: T.surf,
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    background: T.surf2,
                    borderBottom: `1px solid ${T.border}`,
                    fontFamily: "Oswald",
                    fontSize: 13,
                    color: T.accent,
                  }}
                >
                  Users ({users.length})
                </div>
                {users.map((u) => (
                  <div
                    key={u.id}
                    onClick={() => {
                      setSelUser(u);
                      loadUserPreds(u.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "9px 12px",
                      borderBottom: `1px solid ${T.border}22`,
                      cursor: "pointer",
                      background:
                        selUser?.id === u.id ? `${T.accent}15` : "transparent",
                      transition: "background .15s",
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: `${T.accent}33`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        color: T.accent,
                      }}
                    >
                      {u.username[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {u.username}
                      </div>
                      <div style={{ fontSize: 10, color: T.muted }}>
                        {u.total_points} pts · {u.total_bets} bets
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  background: T.surf,
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    background: T.surf2,
                    borderBottom: `1px solid ${T.border}`,
                    fontFamily: "Oswald",
                    fontSize: 13,
                    color: T.accent,
                  }}
                >
                  {selUser
                    ? `${selUser.username}'s Predictions`
                    : "Select a user →"}
                </div>
                {loading && (
                  <div
                    style={{ padding: 30, textAlign: "center", color: T.muted }}
                  >
                    Loading…
                  </div>
                )}
                {selUser && !loading && (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4,1fr)",
                        borderBottom: `1px solid ${T.border}`,
                      }}
                    >
                      {[
                        { l: "Points", v: selUser.total_points, c: T.accent },
                        { l: "Bets", v: selUser.total_bets, c: T.blue },
                        { l: "Correct", v: selUser.correct_bets, c: T.green },
                        {
                          l: "Accuracy",
                          v: `${selUser.total_bets > 0 ? Math.round((selUser.correct_bets / selUser.total_bets) * 100) : 0}%`,
                          c: T.purple,
                        },
                      ].map((s, i) => (
                        <div
                          key={i}
                          style={{
                            padding: "10px",
                            textAlign: "center",
                            borderRight: `1px solid ${T.border}44`,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: "Oswald",
                              fontSize: 17,
                              fontWeight: 700,
                              color: s.c,
                            }}
                          >
                            {s.v}
                          </div>
                          <div style={{ fontSize: 10, color: T.muted }}>
                            {s.l}
                          </div>
                        </div>
                      ))}
                    </div>
                    {userPreds.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          padding: "7px 14px",
                          borderBottom: `1px solid ${T.border}22`,
                          fontSize: 11,
                        }}
                      >
                        <span style={{ flex: 1, color: T.muted }}>
                          {p.match_id}
                        </span>
                        <span
                          style={{
                            fontFamily: "Oswald",
                            color: T.accent,
                            fontWeight: 700,
                          }}
                        >
                          {p.predicted_home_score}–{p.predicted_away_score}
                        </span>
                        <span style={{ color: T.muted }}>
                          {fmtOdds(p.odds_at_submission)}
                        </span>
                        {p.is_locked ? (
                          <span style={{ color: T.red, fontSize: 10 }}>🔒</span>
                        ) : (
                          <span style={{ color: T.green, fontSize: 10 }}>
                            ✓
                          </span>
                        )}
                        <span style={{ color: T.muted, fontSize: 10 }}>
                          {new Date(p.submitted_at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                    {userPreds.length === 0 && (
                      <div
                        style={{
                          padding: 20,
                          textAlign: "center",
                          color: T.muted,
                          fontSize: 12,
                        }}
                      >
                        No predictions yet
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {view === "preds" && (
            <div className="fade-up">
              <div
                style={{
                  background: T.surf,
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    background: T.surf2,
                    borderBottom: `1px solid ${T.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "Oswald",
                      fontSize: 13,
                      color: T.accent,
                    }}
                  >
                    All Predictions ({allPreds.length})
                  </span>
                  <span style={{ fontSize: 11, color: T.muted }}>
                    Read-only · Cannot be modified
                  </span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 11,
                    }}
                  >
                    <thead>
                      <tr style={{ background: T.surf3 }}>
                        {[
                          "User",
                          "Match",
                          "Score",
                          "Odds",
                          "Payout",
                          "Date",
                          "Lock",
                          "Result",
                        ].map((h) => (
                          <th
                            key={h}
                            style={{
                              padding: "7px 10px",
                              textAlign: "left",
                              color: T.muted,
                              fontWeight: 700,
                              borderBottom: `1px solid ${T.border}`,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allPreds.map((p, i) => (
                        <tr
                          key={p.id}
                          style={{
                            borderBottom: `1px solid ${T.border}22`,
                            background: i % 2 === 0 ? "transparent" : T.surf2,
                          }}
                        >
                          <td
                            style={{
                              padding: "7px 10px",
                              color: T.blue,
                              fontWeight: 600,
                            }}
                          >
                            {p.profiles?.username}
                          </td>
                          <td style={{ padding: "7px 10px", color: T.muted }}>
                            {p.match_id}
                          </td>
                          <td
                            style={{
                              padding: "7px 10px",
                              fontFamily: "Oswald",
                              color: T.accent,
                              fontWeight: 700,
                            }}
                          >
                            {p.predicted_home_score}–{p.predicted_away_score}
                          </td>
                          <td style={{ padding: "7px 10px" }}>
                            {fmtOdds(p.odds_at_submission)}
                          </td>
                          <td style={{ padding: "7px 10px", color: T.green }}>
                            {p.potential_payout}
                          </td>
                          <td
                            style={{
                              padding: "7px 10px",
                              color: T.muted,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {new Date(p.submitted_at).toLocaleDateString()}
                          </td>
                          <td style={{ padding: "7px 10px" }}>
                            {p.is_locked ? (
                              <span style={{ color: T.red, fontSize: 10 }}>
                                🔒
                              </span>
                            ) : (
                              <span style={{ color: T.green, fontSize: 10 }}>
                                ✓
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "7px 10px" }}>
                            {p.result_status ? (
                              <span
                                className="chip"
                                style={{
                                  background: `${p.result_status === "exact" ? T.accent : p.result_status === "correct" ? T.green : T.red}22`,
                                  color:
                                    p.result_status === "exact"
                                      ? T.accent
                                      : p.result_status === "correct"
                                        ? T.green
                                        : T.red,
                                }}
                              >
                                {p.result_status}
                              </span>
                            ) : (
                              <span style={{ color: T.muted, fontSize: 9 }}>
                                pending
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {view === "audit" && (
            <div className="fade-up">
              <div
                style={{
                  background: `${T.orange}12`,
                  border: `1px solid ${T.orange}33`,
                  borderRadius: 9,
                  padding: "10px 14px",
                  marginBottom: 12,
                  fontSize: 12,
                  color: T.text,
                }}
              >
                📋 Immutable audit log — every prediction event is permanently
                recorded. No record can be modified or deleted by anyone,
                including administrators.
              </div>
              <div
                style={{
                  background: T.surf,
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    background: T.surf2,
                    borderBottom: `1px solid ${T.border}`,
                    fontFamily: "Oswald",
                    fontSize: 13,
                    color: T.accent,
                  }}
                >
                  Audit Log ({auditLog.length} events)
                </div>
                {auditLog.map((log, i) => (
                  <div
                    key={log.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "8px 14px",
                      borderBottom: `1px solid ${T.border}22`,
                      fontSize: 11,
                    }}
                  >
                    <span
                      style={{ color: T.muted, minWidth: 28, fontWeight: 700 }}
                    >
                      #{i + 1}
                    </span>
                    <span
                      style={{ color: T.blue, minWidth: 80, fontWeight: 600 }}
                    >
                      {log.profiles?.username || "system"}
                    </span>
                    <span
                      className="chip"
                      style={{
                        background: `${T.accent}22`,
                        color: T.accent,
                        flexShrink: 0,
                      }}
                    >
                      {log.action}
                    </span>
                    <span style={{ color: T.muted, minWidth: 80 }}>
                      {log.table_name}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        color: T.muted,
                        fontSize: 10,
                        fontFamily: "monospace",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {log.record_id}
                    </span>
                    <span
                      style={{
                        color: T.muted,
                        fontSize: 10,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function LockedMsg({ msg, T }) {
  return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <div style={{ fontSize: 54 }}>🔒</div>
      <h2
        style={{
          fontFamily: "Oswald",
          fontSize: 24,
          color: T.accent,
          marginTop: 14,
        }}
      >
        Not Yet Unlocked
      </h2>
      <p style={{ color: T.muted, marginTop: 8 }}>{msg}</p>
    </div>
  );
}
function Loader({ T }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: T?.bg || "#06090f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 14,
        fontFamily: "Rajdhani,sans-serif",
      }}
    >
      <div style={{ fontSize: 46, animation: "spin 1s linear infinite" }}>
        ⚽
      </div>
      <div style={{ color: T?.muted || "#888", fontSize: 14 }}>Loading…</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
function Toast({ msg, type, T }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 9999,
        background: type === "error" ? T.red : T.green,
        color: "#fff",
        padding: "10px 16px",
        borderRadius: 9,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 4px 20px rgba(0,0,0,.4)",
        animation: "fadeUp .3s ease forwards",
        maxWidth: 300,
      }}
    >
      {type === "error" ? "❌" : "✅"} {msg}
    </div>
  );
}

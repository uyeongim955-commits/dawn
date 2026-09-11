/**
 * 새벽의 태양 갤러리 SVG Worker · 1000x640  (/독자반응 이미지판)
 * 원작 소년만화 《새벽의 태양》 독자 커뮤니티를 흉내 낸 가짜 화면.
 * l 파라미터가 있으면 글목록, 없으면 게시글.
 *
 * 글목록
 * - g: 갤러리명 (기본 새벽의 태양)
 * - d: 기준 시각. HH:MM 또는 M/D HH:MM 또는 YYYY.M.D HH:MM (행마다 1분씩 과거로)
 * - o: 공지 제목, ; 구분 (최대 2, 생략 가능)
 * - l: 글 목록, "제목~닉~조회~추천~댓글" 을 ; 로 구분 (최대 8)
 *      제목 앞에 ? 를 붙이면 말머리 질문, ! 를 붙이면 개념글 표시
 *
 * 게시글
 * - g: 갤러리명 / t: 제목 / w: 글쓴이 / d: 작성 시각
 * - v: 조회 / r: 추천 / x: 비추 / s: 본문
 * - c: 댓글 "닉~내용;닉~내용" (최대 6). 닉 앞에 ↳ 또는 ㄴ 를 붙이면 대댓글
 *
 * 닉 앞에 * 를 붙이면 고정닉 (배지 표시, IP 없음).
 * 붙이지 않으면 유동닉으로 취급되어 닉 뒤에 (IP 앞자리)가 자동 표기됨.
 * IP는 닉+제목에서 결정적으로 생성되는 가짜 값.
 *
 * 공백은 + 로 표기. 퍼센트 인코딩 불필요.
 *
 * 개인정보 최소화 설계
 * - request.cf, IP, 헤더, 쿠키, User-Agent를 읽지 않음. Set-Cookie 없음.
 * - console, fetch, KV, D1, R2, Analytics, 외부 이미지·폰트·스크립트 없음.
 * - 화면의 (IP)는 닉+제목 해시로 만든 가짜 값. 실제 접속자와 무관.
 * - 응답 헤더: CSP default-src 'none', Referrer-Policy no-referrer, Permissions-Policy 전부 차단.
 * - 본문·댓글 텍스트만 URL에 실려 Cloudflare 네트워크를 경유함. 이건 구조상 불가피.
 * - wrangler: logpush=false, observability.enabled=false. 배포 후 대시보드
 *   Settings > Observability > Workers Logs 도 Off 인지 확인할 것 (코드로 못 끔).
 *
 * 방어 · 프챗급 방탄
 * - 어떤 GET에도 400을 내지 않음: 미지 키·중복 키 무시, 전각 기호·&amp; 자동 교정,
 *   초과 길이 절단. 목록 줄에 닉·조회·추천이 빠지면 결정적 해시로 그럴듯하게 채움.
 * - 모든 텍스트의 XML 특수문자는 이스케이프.
 * - 외부 통신·저장소·분석 코드 없음. IP·헤더·쿠키 미참조.
 */

const W = 1000;
const H = 640;
const NAVY = "#3a4a8c";
const LINK = "#1f2937";

function esc(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function charWidth(ch, size) {
  const c = ch.codePointAt(0);
  if (c >= 0x1100 && c <= 0x11ff) return size;
  if (c >= 0x3130 && c <= 0x318f) return size;
  if (c >= 0xac00 && c <= 0xd7a3) return size;
  if (c >= 0x4e00 && c <= 0x9fff) return size;
  if (c >= 0x3000 && c <= 0x303f) return size;
  if (ch === " ") return size * 0.28;
  if (/[A-Z]/.test(ch)) return size * 0.63;
  if (/[iIljt.,;:'!|]/.test(ch)) return size * 0.3;
  return size * 0.52;
}

function measure(text, size) {
  let w = 0;
  for (const ch of text) w += charWidth(ch, size);
  return w;
}

function clip(text, size, maxWidth) {
  if (measure(text, size) <= maxWidth) return text;
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = charWidth(ch, size);
    if (w + cw > maxWidth - size) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

function wrapText(text, size, maxWidth, maxLines) {
  const lines = [];
  let line = "";
  let width = 0;
  for (const ch of text) {
    const w = charWidth(ch, size);
    if (width + w > maxWidth && line) {
      lines.push(line);
      if (lines.length >= maxLines) {
        lines[lines.length - 1] = lines[lines.length - 1].replace(/.$/, "…");
        return lines;
      }
      line = ch === " " ? "" : ch;
      width = ch === " " ? 0 : w;
    } else {
      line += ch;
      width += w;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

// 숫자면 그대로, 누락·오기면 시드 기반 결정값으로 채움 — 같은 글은 언제나 같은 수치
function num(raw, seed, lo, hi) {
  const d = String(raw ?? "").replace(/[^\d]/g, "").slice(0, 7);
  if (d) return Number(d).toLocaleString("en-US");
  return (lo + (fnv(seed) % (hi - lo + 1))).toLocaleString("en-US");
}

// d 값에서 날짜 부분과 HH:MM 을 분리. 날짜는 없어도 된다.
function splitDate(raw) {
  const t = /(\d{1,2}):(\d{2})/.exec(raw || "");
  const datePart = (raw || "").replace(t ? t[0] : "", "").replace(/[⏱\s]+/g, " ").trim();
  return { date: datePart.slice(0, 12), hh: t ? Number(t[1]) : 18, mm: t ? Number(t[2]) : 15 };
}

// 목록 행: 시각만, 행마다 1분씩 과거로
function shiftTime(base, minutes) {
  const { hh, mm } = splitDate(base);
  const total = ((hh * 60 + mm - minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// 게시글: "날짜 HH:MM" 그대로
function fullTime(base) {
  const { date, hh, mm } = splitDate(base);
  const t = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return date ? `${date} ${t}` : t;
}

function fnv(seed) {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// 결정적 가짜 IP 앞 두 옥텟 (유동닉 표시용, 실제 IP 아님)
function fakeIp(seed) {
  const h = fnv(seed);
  return `${100 + (h % 124)}.${(h >>> 9) % 256}`;
}

// 이 조각이 닉처럼 보이는가. 디시 닉은 짧고 문장부호가 없다.
function looksLikeNick(s) {
  const t = String(s || "").trim().replace(/^\*/, "");
  if (!t || t.length > 12) return false;
  if (/[.?!,~]/.test(t)) return false;                 // 문장부호 → 내용
  if ((t.match(/ /g) || []).length > 1) return false;  // 공백 2개 이상 → 문장
  if (/^[ㅋㅎㅠㅜ]{3,}/.test(t)) return false;          // ㅋㅋㅋ… → 내용
  return true;
}

// a~b 가 "내용~닉" 으로 뒤집혀 있으면 바로잡는다
function orient(a, b) {
  if (a && b && !looksLikeNick(a) && looksLikeNick(b)) return [b, a];
  return [a, b];
}

// 목록 줄은 "제목~닉" 순서. 왼쪽이 닉 같고 오른쪽이 문장 같으면 뒤집힌 것
function orientList(title, nick) {
  if (title && nick && looksLikeNick(title) && !looksLikeNick(nick)) return [nick, title];
  return [title, nick];
}

function parseNick(raw, seed) {
  let nick = (raw || "ㅇㅇ").slice(0, 15);
  const fixed = nick.startsWith("*");
  if (fixed) nick = nick.slice(1) || "ㅇㅇ";
  return { nick, fixed, ip: fixed ? "" : fakeIp(nick + "|" + seed) };
}

// 전각 기호를 반각으로 (프챗급 모델이 섞어 쓰는 ；～：！＊ 등)
const FW_MAP = { "；": ";", "｜": "|", "～": "~", "：": ":", "！": "!", "？": "?", "＊": "*", "＋": " ", "　": " ", "＆": "&", "＝": "=" };
function fwNorm(s) {
  return s.replace(/[；｜～：！？＊＋　＆＝０-９]/g, (c) => FW_MAP[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 프챗급 방탄 — 절대 400을 내지 않는다.
// 경로 무관 · 미지 키 무시 · 중복 키는 첫 유효값 · 구조 깨진 전각 ＆＝·&amp;는 교정 · 초과 길이는 절단.
function lenientParams(search, cap) {
  let raw = search.startsWith("?") ? search.slice(1) : search;
  if (raw.length > cap) raw = raw.slice(0, cap);
  raw = raw
    .replace(/&(amp;)+/gi, "&")
    .replace(/%EF%BC%86/gi, "&").replace(/[＆]/g, "&")
    .replace(/%EF%BC%9D/gi, "=").replace(/[＝]/g, "=");
  let sp;
  try { sp = new URLSearchParams(raw); } catch (e) { sp = new URLSearchParams(); }
  const first = new Map();
  for (const [rk, rv] of sp) {
    const key = rk.trim().toLowerCase();
    if (!first.has(key) || first.get(key) === "") first.set(key, String(rv));
  }
  return first;
}

function parseInput(url) {
  const first = lenientParams(url.search, 6000);
  const get = (key) => fwNorm(first.get(key) ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const hasList = first.has("l");

  const board = get("g").slice(0, 14) || "새벽의 태양";
  const date = get("d").slice(0, 24);
  const rawList = get("l");

  if (hasList || rawList) {
    const rows = rawList.split(/[;|]/).map((s) => s.trim())
      .filter(Boolean).slice(0, 8).map((row, i) => {
      let [rawTitle, nick, views, ups, cmts] = row.split("~");
      // 말머리(?!*)가 붙어 있으면 그쪽이 제목 확정 — 없을 때만 순서를 의심한다
      if (!/^[?!*]/.test(String(rawTitle || "").trim())) {
        [rawTitle, nick] = orientList(rawTitle, nick);
      }
      let title = (rawTitle || "제목 없음").trim().replace(/^【\s*|\s*】$/g, "").slice(0, 40);
      let mark = "일반";
      let hot = false;
      while (/^[?!*]/.test(title)) {
        if (title[0] === "?") mark = "질문";
        if (title[0] === "!") hot = true;
        title = title.slice(1);
      }
      title = title.trim() || "제목 없음";
      const nRaw = (cmts || "").trim();
      const nAuto = fnv(title + "n") % 9;
      return {
        no: 1207315 - i,
        mark,
        hot,
        title,
        cmts: /^\d{1,4}$/.test(nRaw) ? nRaw : (nAuto ? String(nAuto) : ""),
        who: parseNick(nick, title + i),
        time: shiftTime(date || "18:15", i),
        views: num(views, title + "v", 214, 4890),
        ups: num(ups, title + "u", 2, 47),
      };
    });
    const notices = get("o").split(/[;|]/).filter(Boolean).slice(0, 2).map((n) => n.slice(0, 34));
    return { mode: "list", board, rows, notices };
  }

  const title = get("t").replace(/^[?!*\s]+/, "").replace(/^【\s*|\s*】$/g, "").slice(0, 52) || "제목 없음";
  return {
    mode: "post",
    board,
    title,
    who: parseNick(get("w"), title),
    date: fullTime(date),
    views: num(get("v"), title + "v", 512, 9740),
    up: num(get("r"), title + "u", 5, 128),
    down: num(get("x"), title + "d", 0, 31),
    body: get("s").slice(0, 420),
    comments: get("c").split(/[;|]/).map((s) => s.trim()).filter(Boolean).slice(0, 6).map((row, i) => {
      let r = row;
      let depth = 0;
      while (/^[↳└ㄴ]/.test(r) && depth < 2) { depth += 1; r = r.slice(1).trim(); }
      r = r.replace(/^[↳└ㄴ]+/, "").trim();
      const k = r.indexOf("~");
      let nick = k === -1 ? "" : r.slice(0, k).trim();
      let text = k === -1 ? r : r.slice(k + 1).trim();
      if (!text) { text = nick; nick = ""; }
      [nick, text] = orient(nick, text);
      if (nick.length > 15) { text = nick + (text ? " " + text : ""); nick = ""; }
      const who = nick || "ㅇㅇ";
      // 같은 별명은 같은 IP, 기본닉 ㅇㅇ 는 사람마다 다른 IP
      const seed = who === "ㅇㅇ" ? title + "c" + i : title;
      return { who: parseNick(who, seed), depth, text: text.slice(0, 110) };
    }),
  };
}

// 고정닉 배지
function badge(x, y, s) {
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="2.5" fill="${NAVY}"/>
  <circle cx="${x + s / 2}" cy="${y + s * 0.38}" r="${s * 0.17}" fill="#ffffff"/>
  <path d="M${x + s * 0.22} ${y + s * 0.82} a${s * 0.29} ${s * 0.26} 0 0 1 ${s * 0.56} 0 Z" fill="#ffffff"/>`;
}

// 가운데 정렬 닉 셀 (목록용)
function nickCell(who, cx, y) {
  if (who.fixed) {
    const label = clip(who.nick, 13, 96);
    const w = 19 + measure(label, 13);
    const x0 = cx - w / 2;
    return `${badge(x0, y - 11.5, 14)}<text x="${x0 + 19}" y="${y}" class="fnick">${esc(label)}</text>`;
  }
  const label = clip(who.nick, 13, 82);
  return `<text x="${cx}" y="${y}" text-anchor="middle" class="cell">${esc(label)}<tspan fill="#b0b6bf">(${who.ip})</tspan></text>`;
}

// 왼쪽 정렬 닉 (게시글·댓글용). 렌더 문자열과 다음 요소 시작 x 를 반환
function nickInline(who, x, y, size) {
  if (who.fixed) {
    const s = size + 1;
    const el = `${badge(x, y - s + 2.5, s)}<text x="${x + s + 5}" y="${y}" class="fnick" font-size="${size}px">${esc(who.nick)}</text>`;
    return { el, next: x + s + 5 + measure(who.nick, size) };
  }
  const label = `${who.nick}(${who.ip})`;
  const el = `<text x="${x}" y="${y}" class="nick" font-size="${size}px">${esc(who.nick)}<tspan fill="#aeb4bd" font-weight="500">(${who.ip})</tspan></text>`;
  return { el, next: x + measure(label, size) };
}

function chrome(board) {
  return `
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="36" y="38" class="wordmark">만화인사이드<tspan class="wordmark-dim">.com</tspan></text>
  <text x="${36 + Math.round(measure("만화인사이드.com", 24)) + 14}" y="38" class="minor">마이너 갤러리</text>
  <rect x="430" y="18" width="300" height="30" rx="2" fill="#ffffff" stroke="${NAVY}" stroke-width="1.6"/>
  <text x="444" y="38" class="ph">갤러리 &amp; 통합검색</text>
  <rect x="700" y="18" width="30" height="30" rx="2" fill="${NAVY}"/>
  <circle cx="713" cy="31" r="5" fill="none" stroke="#ffffff" stroke-width="1.6"/>
  <line x1="717" y1="35" x2="721" y2="39" stroke="#ffffff" stroke-width="1.6"/>

  <rect x="0" y="58" width="${W}" height="36" fill="${NAVY}"/>
  <text x="36" y="82" class="nav">갤러리</text>
  <text x="112" y="82" class="nav" fill="#ffd75e">마이너갤</text>
  <text x="204" y="82" class="nav">미니갤</text>
  <text x="284" y="82" class="nav">만화갤</text>
  <text x="364" y="82" class="nav">갤로그</text>
  <text x="964" y="82" text-anchor="end" class="navdim">연재 중 · 스포일러 주의</text>

  <text x="36" y="132" class="gtitle">${esc(board)} 갤러리</text>
  <circle cx="${44 + Math.round(measure(board + " 갤러리", 26))}" cy="124" r="10" fill="#e8eaf4"/>
  <text x="${44 + Math.round(measure(board + " 갤러리", 26))}" y="129" text-anchor="middle" class="mbadge">M</text>
  <line x1="36" y1="150" x2="964" y2="150" stroke="#d6d9e3"/>`;
}

const STYLE = `
  <style>
    text { font-family: system-ui, -apple-system, "SamsungOne", "Samsung Sans", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
    .wordmark { font-size: 24px; font-weight: 800; fill: #1c2340; letter-spacing: -1px; }
    .wordmark-dim { fill: #8d93a8; }
    .minor { font-size: 13px; font-weight: 600; fill: #8d93a8; letter-spacing: -.3px; }
    .ph { font-size: 13.5px; font-weight: 450; fill: #9aa0b0; letter-spacing: -.2px; }
    .nav { font-size: 14.5px; font-weight: 700; fill: #ffffff; letter-spacing: -.3px; }
    .navdim { font-size: 12.5px; font-weight: 500; fill: #b9c0e4; letter-spacing: -.2px; }
    .gtitle { font-size: 26px; font-weight: 800; fill: #14171b; letter-spacing: -1px; }
    .mbadge { font-size: 11px; font-weight: 800; fill: #4a5490; }
    .th { font-size: 13px; font-weight: 700; fill: #6b7280; letter-spacing: -.2px; }
    .no { font-size: 13px; font-weight: 500; fill: #9aa0b0; }
    .mark { font-size: 12.5px; font-weight: 600; fill: #6b7280; }
    .row { font-size: 16px; font-weight: 500; fill: ${LINK}; letter-spacing: -.4px; }
    .cmt-n { font-size: 13px; font-weight: 700; fill: #c0392b; }
    .cell { font-size: 13px; font-weight: 500; fill: #6b7280; letter-spacing: -.2px; }
    .fnick { font-size: 13px; font-weight: 700; fill: #333c56; letter-spacing: -.3px; }
    .notice { font-size: 15px; font-weight: 700; fill: #1c2340; letter-spacing: -.4px; }
    .ptitle { font-size: 23px; font-weight: 700; fill: #14171b; letter-spacing: -.8px; }
    .meta { font-size: 13.5px; font-weight: 500; fill: #8d939d; letter-spacing: -.2px; }
    .nick { font-size: 14px; font-weight: 700; fill: #3f4750; letter-spacing: -.3px; }
    .body { font-size: 17.5px; font-weight: 450; fill: #23272b; letter-spacing: -.3px; }
    .cmt { font-size: 15.5px; font-weight: 450; fill: #2b3036; letter-spacing: -.3px; }
    .cnt { font-size: 15px; font-weight: 700; fill: #14171b; letter-spacing: -.3px; }
    .vote { font-size: 16px; font-weight: 800; letter-spacing: -.3px; }
    .btn { font-size: 14px; font-weight: 700; fill: #ffffff; letter-spacing: -.3px; }
    .foot { font-size: 11.5px; font-weight: 450; fill: #b3bac1; letter-spacing: -.1px; }
  </style>`;

function listSvg({ board, rows, notices }) {
  const TOP = 170;
  const RH = 34;
  let y = TOP;

  const head = `
  <rect x="36" y="${TOP}" width="928" height="32" fill="#f7f8fa"/>
  <line x1="36" y1="${TOP}" x2="964" y2="${TOP}" stroke="#c9cdd8"/>
  <line x1="36" y1="${TOP + 32}" x2="964" y2="${TOP + 32}" stroke="#e2e5ec"/>
  <text x="70" y="${TOP + 21}" text-anchor="middle" class="th">번호</text>
  <text x="148" y="${TOP + 21}" text-anchor="middle" class="th">말머리</text>
  <text x="196" y="${TOP + 21}" class="th">제목</text>
  <text x="712" y="${TOP + 21}" text-anchor="middle" class="th">글쓴이</text>
  <text x="828" y="${TOP + 21}" text-anchor="middle" class="th">작성일</text>
  <text x="892" y="${TOP + 21}" text-anchor="middle" class="th">조회</text>
  <text x="944" y="${TOP + 21}" text-anchor="middle" class="th">추천</text>`;
  y = TOP + 32;

  const noticeRows = notices.map((n) => {
    const el = `
    <rect x="36" y="${y}" width="928" height="${RH}" fill="#fbfbfd"/>
    <text x="70" y="${y + 22}" text-anchor="middle" class="no">공지</text>
    <text x="148" y="${y + 22}" text-anchor="middle" class="mark">공지</text>
    <rect x="196" y="${y + 10}" width="14" height="14" rx="7" fill="#e8654a"/>
    <text x="203" y="${y + 21}" text-anchor="middle" font-size="10" font-weight="800" fill="#ffffff">!</text>
    <text x="218" y="${y + 22}" class="notice">${esc(clip(n, 15, 460))}</text>
    ${badge(676, y + 10.5, 14)}<text x="695" y="${y + 22}" class="fnick">운영자</text>
    <text x="828" y="${y + 22}" text-anchor="middle" class="cell">필독</text>
    <text x="892" y="${y + 22}" text-anchor="middle" class="cell">—</text>
    <text x="944" y="${y + 22}" text-anchor="middle" class="cell">—</text>
    <line x1="36" y1="${y + RH}" x2="964" y2="${y + RH}" stroke="#eef0f4"/>`;
    y += RH;
    return el;
  }).join("");

  const postRows = rows.map((r) => {
    const titleW = 452 - (r.cmts ? 34 : 0);
    const t = clip(r.title, 16, titleW);
    const el = `
    <rect x="36" y="${y}" width="928" height="${RH}" fill="#ffffff"/>
    <text x="70" y="${y + 22}" text-anchor="middle" class="no">${r.no}</text>
    <text x="148" y="${y + 22}" text-anchor="middle" class="mark">${r.mark}</text>
    <path d="M196 ${y + 12} h11 v11 h-11 Z" fill="${r.hot ? "#e8654a" : "#5aa469"}" opacity=".85"/>
    <text x="216" y="${y + 22}" class="row">${esc(t)}</text>
    ${r.cmts ? `<text x="${220 + Math.round(measure(t, 16))}" y="${y + 22}" class="cmt-n">[${esc(r.cmts)}]</text>` : ""}
    ${nickCell(r.who, 712, y + 22)}
    <text x="828" y="${y + 22}" text-anchor="middle" class="cell">${r.time}</text>
    <text x="892" y="${y + 22}" text-anchor="middle" class="cell">${r.views}</text>
    <text x="944" y="${y + 22}" text-anchor="middle" class="cell">${r.ups}</text>
    <line x1="36" y1="${y + RH}" x2="964" y2="${y + RH}" stroke="#eef0f4"/>`;
    y += RH;
    return el;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?><!--DAWN1-->
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(board)} 갤러리 글목록">
${STYLE}
${chrome(board)}
${head}
${noticeRows}
${postRows}
  <rect x="874" y="${Math.min(y + 12, 592)}" width="90" height="30" rx="4" fill="${NAVY}"/>
  <text x="919" y="${Math.min(y + 32, 612)}" text-anchor="middle" class="btn">글쓰기</text>
  <text x="36" y="628" class="foot">만화인사이드 · 새벽의 태양 마이너 갤러리 · 게시물은 독자 개인 의견이며 스포일러를 포함할 수 있음</text>
</svg>`;
}

function postSvg({ board, title, who, date, views, up, down, body, comments }) {
  const titleLines = wrapText(title, 23, 900, 2);
  const bodyLines = wrapText(body, 17.5, 900, 4);

  const titleTop = 178;
  const metaY = titleTop + titleLines.length * 30 + 6;
  const bodyTop = metaY + 30;
  const bodyBottom = bodyTop + bodyLines.length * 30 + 6;
  const voteY = bodyBottom + 10;
  const cHeadY = voteY + 50;
  let cy = cHeadY + 16;

  // 댓글은 디시처럼 닉·내용 한 줄 — 본문이 길어도 6개까지 안 잘리게
  const laid = [];
  for (const c of comments) {
    const indent = c.depth * 26;
    if (cy + 28 > 618) break;
    laid.push({ ...c, y: cy, indent });
    cy += 28;
  }

  const wn = nickInline(who, 36, metaY + 18, 13.5);

  return `<?xml version="1.0" encoding="UTF-8"?><!--DAWN1-->
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(board)} 갤러리 ${esc(title)}">
${STYLE}
${chrome(board)}
  ${titleLines.map((ln, i) => `<text x="36" y="${titleTop + 22 + i * 30}" class="ptitle">${esc(ln)}</text>`).join("")}
  ${wn.el}
  <text x="${Math.round(wn.next) + 8}" y="${metaY + 18}" class="meta">·  ${esc(date)}  ·  조회 ${views}  ·  추천 ${up}</text>
  <line x1="36" y1="${metaY + 30}" x2="964" y2="${metaY + 30}" stroke="#eef0f4"/>

  ${bodyLines.map((ln, i) => `<text x="36" y="${bodyTop + 22 + i * 30}" class="body">${esc(ln)}</text>`).join("")}
  <line x1="36" y1="${bodyBottom + 4}" x2="964" y2="${bodyBottom + 4}" stroke="#eef0f4"/>

  <rect x="${W / 2 - 116}" y="${voteY}" width="110" height="42" rx="21" fill="#fdeceb" stroke="#f0c4bd"/>
  <text x="${W / 2 - 61}" y="${voteY + 28}" text-anchor="middle" class="vote" fill="#c0392b">▲ ${up}</text>
  <rect x="${W / 2 + 6}" y="${voteY}" width="110" height="42" rx="21" fill="#eef1f5" stroke="#dbdfe6"/>
  <text x="${W / 2 + 61}" y="${voteY + 28}" text-anchor="middle" class="vote" fill="#6c757e">▼ ${down}</text>

  <rect x="36" y="${cHeadY - 15}" width="4" height="17" rx="2" fill="${NAVY}"/>
  <text x="50" y="${cHeadY}" class="cnt">댓글 ${comments.length}</text>
  <line x1="36" y1="${cHeadY + 10}" x2="964" y2="${cHeadY + 10}" stroke="#eef0f4"/>

  ${laid.map((c) => {
    const ni = nickInline(c.who, 36 + c.indent, c.y + 19, 14);
    const tx = Math.round(ni.next) + 12;
    return `
  ${c.depth ? `<text x="${12 + c.indent}" y="${c.y + 19}" class="meta" fill="#b3bac1">ㄴ</text>` : ""}
  ${ni.el}
  <text x="${tx}" y="${c.y + 19}" class="cmt">${esc(clip(c.text, 15.5, 950 - tx))}</text>
  <line x1="${36 + c.indent}" y1="${c.y + 27}" x2="964" y2="${c.y + 27}" stroke="#f4f5f8"/>`;
  }).join("")}

  <text x="36" y="628" class="foot">만화인사이드 · 새벽의 태양 마이너 갤러리 · 게시물은 독자 개인 의견이며 스포일러를 포함할 수 있음</text>
</svg>`;
}

function responseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=(), usb=(), browsing-topics=()",
    "X-Content-Type-Options": "nosniff",
  };
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { ...responseHeaders("text/plain; charset=utf-8"), Allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    const data = parseInput(url);

    const svg = data.mode === "list" ? listSvg(data) : postSvg(data);
    return new Response(request.method === "HEAD" ? null : svg, {
      status: 200,
      headers: responseHeaders("image/svg+xml; charset=utf-8"),
    });
  },
};

import { useState, useMemo, useCallback, useRef } from "react";

const DIFFICULTY_LABELS = { high: "상", mid: "중", low: "하" };
const DIFFICULTY_COLORS = {
  high: { bg: "#FFF1F0", border: "#FF4D4F", text: "#CF1322", tag: "#FF4D4F" },
  mid: { bg: "#FFF7E6", border: "#FFA940", text: "#AD6800", tag: "#FFA940" },
  low: { bg: "#F0F5FF", border: "#597EF7", text: "#1D39C4", tag: "#597EF7" },
};

const DEFAULT_RATIOS = { high: 25, mid: 50, low: 25 };

const RULES = [
  {
    id: "maxDouble",
    label: "최대 배점이 최소 배점의 2배 이상이 되지 않기",
    description: "선택형·서술형 각각 적용",
  },
  {
    id: "allowDecimal",
    label: "소수점 배점 허용",
    description: "0.1점 단위 배점 사용 (예: 1.3점, 2.7점)",
  },
];

function generateScores(config) {
  const { type, count, totalScore, ratios, steps, difficultyOrder, rules = {} } = config;
  if (count === 0 || totalScore === 0) return [];

  const orderedDiffs = difficultyOrder || ["low", "mid", "high"];
  const totalRatio = ratios.high + ratios.mid + ratios.low;
  if (totalRatio === 0) return [];

  // 난이도별 문항 수
  const diffCounts = {};
  let assigned = 0;
  orderedDiffs.forEach((d, i) => {
    if (i === orderedDiffs.length - 1) {
      diffCounts[d] = count - assigned;
    } else {
      diffCounts[d] = Math.round((ratios[d] / totalRatio) * count);
      assigned += diffCounts[d];
    }
  });

  // 배점 단계 생성
  const minScore = type === "choice" ? 1 : 2;
  let maxScore = Math.max(minScore, Math.floor(totalScore / Math.max(count * 0.3, 1)));

  // 규칙 적용: 최대 배점 < 최소 배점 × 2 (2배 미만)
  if (rules.maxDouble) {
    maxScore = Math.min(maxScore, minScore * 2 - (rules.allowDecimal ? 0.1 : 1));
  }

  const useDecimal = !!rules.allowDecimal;
  const unit = useDecimal ? 0.1 : 1;
  const roundUnit = (v) => Math.round(v / unit) * unit;

  const stepValues = [];
  for (let i = 0; i < steps; i++) {
    const v = roundUnit(minScore + (maxScore - minScore) * (i / Math.max(steps - 1, 1)));
    if (!stepValues.includes(v)) stepValues.push(v);
  }
  while (stepValues.length < steps && stepValues[stepValues.length - 1] + unit <= maxScore) {
    const next = roundUnit(stepValues[stepValues.length - 1] + unit);
    if (!stepValues.includes(next)) stepValues.push(next);
    else break;
  }
  stepValues.sort((a, b) => a - b);

  // 난이도별 배점 단계 매핑 — 각 배점값은 하나의 난이도에만 할당
  const diffScoreMap = { low: [], mid: [], high: [] };
  const scoreToDiff = {};
  if (stepValues.length <= 3) {
    // 배점 수가 난이도 수 이하일 때: 순서대로 1:1 배정
    const diffs = ["low", "mid", "high"];
    stepValues.forEach((v, i) => {
      const d = diffs[Math.min(i, 2)];
      diffScoreMap[d].push(v);
      scoreToDiff[v] = d;
    });
  } else {
    // 배점 수가 많을 때: 균등 분할하되 겹침 없이
    const third = Math.ceil(stepValues.length / 3);
    stepValues.forEach((v, i) => {
      const d = i < third ? "low" : i < third * 2 ? "mid" : "high";
      diffScoreMap[d].push(v);
      scoreToDiff[v] = d;
    });
  }

  // 각 난이도 최소 1개 배점 보장
  ["low", "mid", "high"].forEach((d) => {
    if (diffScoreMap[d].length === 0) {
      const fallback =
        d === "low" ? stepValues[0] :
        d === "high" ? stepValues[stepValues.length - 1] :
        stepValues[Math.floor(stepValues.length / 2)];
      diffScoreMap[d] = [fallback];
      scoreToDiff[fallback] = d;
    }
  });

  let items = [];
  let num = 1;
  orderedDiffs.forEach((diff) => {
    const c = diffCounts[diff];
    const scores = diffScoreMap[diff];
    for (let i = 0; i < c; i++) {
      const score = scores[i % scores.length];
      items.push({ num: num++, difficulty: diff, score, type });
    }
  });

  // 합계 조정 — 비율은 근사치로 유지하되 총점은 반드시 정확히 맞춤
  // 조정 시 배점이 변하면 해당 배점의 난이도로 업데이트
  let currentTotal = items.reduce((s, it) => s + it.score, 0);
  currentTotal = Math.round(currentTotal * 10) / 10;
  let gap = Math.round((totalScore - currentTotal) * 10) / 10;

  if (gap !== 0 && items.length > 0) {
    const adjUnit = useDecimal ? 0.1 : 1;

    const adjustOrder = gap > 0
      ? items.map((_, i) => i).sort((a, b) => {
          const rank = { high: 0, mid: 1, low: 2 };
          return rank[items[a].difficulty] - rank[items[b].difficulty];
        })
      : items.map((_, i) => i).sort((a, b) => {
          const rank = { low: 0, mid: 1, high: 2 };
          return rank[items[a].difficulty] - rank[items[b].difficulty];
        });

    let iter = 0;
    const maxIter = items.length * 100;
    while (Math.abs(gap) >= adjUnit * 0.9 && iter < maxIter) {
      const idx = adjustOrder[iter % adjustOrder.length];
      const adj = gap > 0 ? adjUnit : -adjUnit;
      const newScore = Math.round((items[idx].score + adj) * 10) / 10;
      if (newScore >= minScore) {
        items[idx].score = newScore;
        gap = Math.round((gap - adj) * 10) / 10;
      }
      iter++;
    }
  }

  // 배점 → 난이도 일관성 보장: 같은 배점은 같은 난이도
  // 각 배점값에서 가장 많이 등장하는 난이도를 기준으로 통일
  const scoreGroups = {};
  items.forEach((it) => {
    const key = it.score.toFixed(1);
    if (!scoreGroups[key]) scoreGroups[key] = {};
    scoreGroups[key][it.difficulty] = (scoreGroups[key][it.difficulty] || 0) + 1;
  });
  const finalScoreDiff = {};
  Object.entries(scoreGroups).forEach(([key, counts]) => {
    // scoreToDiff에 매핑이 있으면 우선 사용, 없으면 최다 난이도
    const origDiff = scoreToDiff[parseFloat(key)];
    if (origDiff && counts[origDiff]) {
      finalScoreDiff[key] = origDiff;
    } else {
      finalScoreDiff[key] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
  });
  items.forEach((it) => {
    it.difficulty = finalScoreDiff[it.score.toFixed(1)];
  });

  // 번호 재정렬 (난이도 순)
  items.sort((a, b) => {
    const order = { low: 0, mid: 1, high: 2 };
    return order[a.difficulty] - order[b.difficulty] || a.num - b.num;
  });
  items.forEach((it, i) => (it.num = i + 1));

  return items;
}

function Badge({ diff }) {
  const c = DIFFICULTY_COLORS[diff];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: 700,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        letterSpacing: "0.5px",
      }}
    >
      {DIFFICULTY_LABELS[diff]}
    </span>
  );
}

function InputGroup({ label, value, onChange, min = 0, max = 999, suffix, small }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <label
        style={{
          fontSize: small ? "12px" : "13px",
          fontWeight: 600,
          color: "#5A6474",
          letterSpacing: "-0.2px",
        }}
      >
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const v = e.target.value === "" ? "" : Number(e.target.value);
            onChange(v === "" ? 0 : Math.min(max, Math.max(min, v)));
          }}
          style={{
            width: small ? "64px" : "80px",
            padding: "8px 10px",
            border: "1.5px solid #D9DFE8",
            borderRadius: "8px",
            fontSize: "15px",
            fontWeight: 600,
            color: "#1A2332",
            background: "#FAFBFC",
            outline: "none",
            transition: "border 0.2s",
            textAlign: "center",
            fontFamily: "'Pretendard Variable', 'Noto Sans KR', sans-serif",
          }}
          onFocus={(e) => (e.target.style.borderColor = "#4361EE")}
          onBlur={(e) => (e.target.style.borderColor = "#D9DFE8")}
        />
        {suffix && (
          <span style={{ fontSize: "13px", color: "#8892A0", fontWeight: 500 }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function RatioBar({ ratios, onChange }) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "12px",
          alignItems: "flex-end",
          marginBottom: "10px",
          flexWrap: "wrap",
        }}
      >
        {["low", "mid", "high"].map((d) => (
          <div key={d} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Badge diff={d} />
            <input
              type="number"
              min={0}
              max={100}
              value={ratios[d]}
              onChange={(e) => {
                const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                onChange({ ...ratios, [d]: v });
              }}
              style={{
                width: "52px",
                padding: "6px 4px",
                border: "1.5px solid #D9DFE8",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: 600,
                textAlign: "center",
                color: "#1A2332",
                background: "#FAFBFC",
                outline: "none",
                fontFamily: "'Pretendard Variable', 'Noto Sans KR', sans-serif",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#4361EE")}
              onBlur={(e) => (e.target.style.borderColor = "#D9DFE8")}
            />
            <span style={{ fontSize: "13px", color: "#8892A0" }}>%</span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          height: "8px",
          borderRadius: "4px",
          overflow: "hidden",
          background: "#EEF0F4",
        }}
      >
        {["low", "mid", "high"].map((d) => {
          const total = ratios.high + ratios.mid + ratios.low || 1;
          return (
            <div
              key={d}
              style={{
                width: `${(ratios[d] / total) * 100}%`,
                background: DIFFICULTY_COLORS[d].tag,
                transition: "width 0.3s ease",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ScoreTable({ items, label }) {
  if (!items.length) return null;
  const total = items.reduce((s, it) => s + it.score, 0);
  const byCounts = {};
  items.forEach((it) => {
    byCounts[it.difficulty] = (byCounts[it.difficulty] || 0) + 1;
  });

  return (
    <div style={{ marginBottom: "20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "16px",
            fontWeight: 700,
            color: "#1A2332",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {label}
          <span
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: "#8892A0",
            }}
          >
            ({items.length}문항)
          </span>
        </h3>
        <span
          style={{
            fontSize: "15px",
            fontWeight: 700,
            color: "#4361EE",
          }}
        >
          소계 {total}점
        </span>
      </div>
      <div
        style={{
          borderRadius: "10px",
          overflow: "hidden",
          border: "1px solid #E4E8EF",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "14px",
          }}
        >
          <thead>
            <tr style={{ background: "#F4F6F9" }}>
              {["번호", "난이도", "배점"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 16px",
                    textAlign: "center",
                    fontWeight: 700,
                    color: "#5A6474",
                    fontSize: "13px",
                    borderBottom: "1px solid #E4E8EF",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr
                key={it.num}
                style={{
                  background: i % 2 === 0 ? "#fff" : "#FAFBFC",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#F0F4FF")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    i % 2 === 0 ? "#fff" : "#FAFBFC")
                }
              >
                <td
                  style={{
                    padding: "9px 16px",
                    textAlign: "center",
                    fontWeight: 600,
                    color: "#1A2332",
                    borderBottom: "1px solid #F0F2F5",
                  }}
                >
                  {it.num}
                </td>
                <td
                  style={{
                    padding: "9px 16px",
                    textAlign: "center",
                    borderBottom: "1px solid #F0F2F5",
                  }}
                >
                  <Badge diff={it.difficulty} />
                </td>
                <td
                  style={{
                    padding: "9px 16px",
                    textAlign: "center",
                    fontWeight: 700,
                    color: "#1A2332",
                    fontSize: "15px",
                    borderBottom: "1px solid #F0F2F5",
                  }}
                >
                  {it.score}점
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginTop: "8px",
          justifyContent: "flex-end",
        }}
      >
        {["low", "mid", "high"].map(
          (d) =>
            byCounts[d] && (
              <span key={d} style={{ fontSize: "12px", color: "#8892A0" }}>
                {DIFFICULTY_LABELS[d]} {byCounts[d]}문항
              </span>
            )
        )}
      </div>
    </div>
  );
}

function SummaryCard({ choiceItems, essayItems, target }) {
  const choiceTotal = choiceItems.reduce((s, it) => s + it.score, 0);
  const essayTotal = essayItems.reduce((s, it) => s + it.score, 0);
  const grandTotal = choiceTotal + essayTotal;
  const diff = grandTotal - target;

  const allItems = [...choiceItems, ...essayItems];
  const byDiff = { high: 0, mid: 0, low: 0 };
  const byDiffCount = { high: 0, mid: 0, low: 0 };
  allItems.forEach((it) => {
    byDiff[it.difficulty] += it.score;
    byDiffCount[it.difficulty]++;
  });

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #1A2332 0%, #2D3A4D 100%)",
        borderRadius: "14px",
        padding: "24px",
        color: "#fff",
        marginBottom: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ fontSize: "13px", color: "#9CA8B8", marginBottom: "4px" }}>
            총 배점
          </div>
          <div style={{ fontSize: "36px", fontWeight: 800, letterSpacing: "-1px" }}>
            {grandTotal}
            <span style={{ fontSize: "16px", fontWeight: 500, marginLeft: "2px" }}>
              / {target}점
            </span>
          </div>
        </div>
        <div
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            background:
              diff === 0
                ? "rgba(82, 196, 26, 0.15)"
                : "rgba(255, 77, 79, 0.15)",
            color: diff === 0 ? "#95DE64" : "#FF7875",
            fontWeight: 700,
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {diff === 0 ? "✓ 완료" : diff > 0 ? `+${diff}점 초과` : `${diff}점 부족`}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.07)",
            borderRadius: "10px",
            padding: "14px",
          }}
        >
          <div style={{ fontSize: "12px", color: "#9CA8B8" }}>선택형</div>
          <div style={{ fontSize: "22px", fontWeight: 700 }}>
            {choiceTotal}
            <span style={{ fontSize: "13px", fontWeight: 400, color: "#9CA8B8" }}>
              점 · {choiceItems.length}문항
            </span>
          </div>
        </div>
        <div
          style={{
            background: "rgba(255,255,255,0.07)",
            borderRadius: "10px",
            padding: "14px",
          }}
        >
          <div style={{ fontSize: "12px", color: "#9CA8B8" }}>서술형</div>
          <div style={{ fontSize: "22px", fontWeight: 700 }}>
            {essayTotal}
            <span style={{ fontSize: "13px", fontWeight: 400, color: "#9CA8B8" }}>
              점 · {essayItems.length}문항
            </span>
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: "12px", color: "#9CA8B8", marginBottom: "8px" }}>
          난이도별 배점 요약
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {["low", "mid", "high"].map((d) => (
            <div
              key={d}
              style={{
                flex: 1,
                minWidth: "90px",
                background: "rgba(255,255,255,0.05)",
                borderRadius: "8px",
                padding: "10px 12px",
                borderLeft: `3px solid ${DIFFICULTY_COLORS[d].tag}`,
              }}
            >
              <div style={{ fontSize: "12px", color: "#9CA8B8" }}>
                {DIFFICULTY_LABELS[d]} ({byDiffCount[d]}문항)
              </div>
              <div style={{ fontSize: "18px", fontWeight: 700 }}>{byDiff[d]}점</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ExamScoreGenerator() {
  const [choiceCount, setChoiceCount] = useState(15);
  const [choiceScore, setChoiceScore] = useState(60);
  const [essayCount, setEssayCount] = useState(3);
  const [essayScore, setEssayScore] = useState(40);
  const [choiceSteps, setChoiceSteps] = useState(5);
  const [essaySteps, setEssaySteps] = useState(3);
  const [choiceRatios, setChoiceRatios] = useState({ ...DEFAULT_RATIOS });
  const [essayRatios, setEssayRatios] = useState({ ...DEFAULT_RATIOS });
  const [generated, setGenerated] = useState(false);
  const [choiceItems, setChoiceItems] = useState([]);
  const [essayItems, setEssayItems] = useState([]);
  const [activeRules, setActiveRules] = useState({ maxDouble: true, allowDecimal: true });
  const resultRef = useRef(null);

  const target = 100;
  const liveTotal = choiceScore + essayScore;

  const handleGenerate = useCallback(() => {
    const ci = generateScores({
      type: "choice",
      count: choiceCount,
      totalScore: choiceScore,
      ratios: choiceRatios,
      steps: choiceSteps,
      rules: activeRules,
    });
    const ei = generateScores({
      type: "essay",
      count: essayCount,
      totalScore: essayScore,
      ratios: essayRatios,
      steps: essaySteps,
      rules: activeRules,
    });
    setChoiceItems(ci);
    setEssayItems(ei);
    setGenerated(true);
    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [choiceCount, choiceScore, essayCount, essayScore, choiceRatios, essayRatios, choiceSteps, essaySteps, activeRules]);

  const handleCSV = useCallback(() => {
    const BOM = "\uFEFF";
    let csv = BOM + "구분,번호,난이도,배점\n";
    choiceItems.forEach((it) => {
      csv += `선택형,${it.num},${DIFFICULTY_LABELS[it.difficulty]},${it.score}\n`;
    });
    essayItems.forEach((it) => {
      csv += `서술형,${it.num},${DIFFICULTY_LABELS[it.difficulty]},${it.score}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "배점표.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [choiceItems, essayItems]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleReset = useCallback(() => {
    setGenerated(false);
    setChoiceItems([]);
    setEssayItems([]);
  }, []);

  return (
    <div
      style={{
        fontFamily: "'Pretendard Variable', 'Noto Sans KR', -apple-system, sans-serif",
        minHeight: "100vh",
        background: "#F0F2F5",
        padding: "0",
      }}
    >
      <style>{`
        @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.css');
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button {
          opacity: 1;
        }
      `}</style>

      {/* Header */}
      <div
        className="no-print"
        style={{
          background: "linear-gradient(135deg, #1A2332 0%, #2D3A4D 100%)",
          padding: "32px 24px 28px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            margin: "0 0 6px",
            fontSize: "26px",
            fontWeight: 800,
            color: "#fff",
            letterSpacing: "-0.5px",
          }}
        >
          📝 중간고사 배점 생성기
        </h1>
        <p style={{ margin: 0, fontSize: "14px", color: "#9CA8B8" }}>
          난이도와 문항 수를 설정하면 자동으로 배점을 생성합니다
        </p>
      </div>

      <div
        style={{
          maxWidth: "680px",
          margin: "0 auto",
          padding: "20px 16px 40px",
        }}
      >
        {/* 실시간 합계 표시 */}
        <div
          className="no-print"
          style={{
            background: liveTotal === target ? "#F0FFF4" : liveTotal > target ? "#FFF1F0" : "#FFFBE6",
            border: `1.5px solid ${liveTotal === target ? "#B7EB8F" : liveTotal > target ? "#FFA39E" : "#FFE58F"}`,
            borderRadius: "10px",
            padding: "14px 18px",
            marginBottom: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#5A6474" }}>
            선택형 + 서술형 배점 합계
          </span>
          <span
            style={{
              fontSize: "20px",
              fontWeight: 800,
              color: liveTotal === target ? "#389E0D" : liveTotal > target ? "#CF1322" : "#D48806",
            }}
          >
            {liveTotal} / {target}점
            {liveTotal === target && " ✓"}
          </span>
        </div>

        {/* 설정 영역 */}
        <div className="no-print">
          {/* 선택형 설정 */}
          <div
            style={{
              background: "#fff",
              borderRadius: "14px",
              padding: "22px",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              border: "1px solid #E8ECF1",
            }}
          >
            <h2
              style={{
                margin: "0 0 16px",
                fontSize: "17px",
                fontWeight: 800,
                color: "#1A2332",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span
                style={{
                  background: "#4361EE",
                  color: "#fff",
                  width: "28px",
                  height: "28px",
                  borderRadius: "8px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "14px",
                }}
              >
                A
              </span>
              선택형 설정
            </h2>
            <div
              style={{
                display: "flex",
                gap: "16px",
                marginBottom: "18px",
                flexWrap: "wrap",
              }}
            >
              <InputGroup
                label="문항 수"
                value={choiceCount}
                onChange={setChoiceCount}
                min={1}
                max={50}
                suffix="문항"
              />
              <InputGroup
                label="총 배점"
                value={choiceScore}
                onChange={setChoiceScore}
                min={0}
                max={100}
                suffix="점"
              />
              <InputGroup
                label="배점 단계"
                value={choiceSteps}
                onChange={setChoiceSteps}
                min={3}
                max={8}
                suffix="단계"
                small
              />
            </div>
            <div style={{ marginBottom: "4px" }}>
              <label
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#5A6474",
                  marginBottom: "8px",
                  display: "block",
                }}
              >
                난이도 비율
              </label>
              <RatioBar ratios={choiceRatios} onChange={setChoiceRatios} />
            </div>
          </div>

          {/* 서술형 설정 */}
          <div
            style={{
              background: "#fff",
              borderRadius: "14px",
              padding: "22px",
              marginBottom: "20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              border: "1px solid #E8ECF1",
            }}
          >
            <h2
              style={{
                margin: "0 0 16px",
                fontSize: "17px",
                fontWeight: 800,
                color: "#1A2332",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span
                style={{
                  background: "#7C3AED",
                  color: "#fff",
                  width: "28px",
                  height: "28px",
                  borderRadius: "8px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "14px",
                }}
              >
                ✎
              </span>
              서술형 설정
            </h2>
            <div
              style={{
                display: "flex",
                gap: "16px",
                marginBottom: "18px",
                flexWrap: "wrap",
              }}
            >
              <InputGroup
                label="문항 수"
                value={essayCount}
                onChange={setEssayCount}
                min={1}
                max={20}
                suffix="문항"
              />
              <InputGroup
                label="총 배점"
                value={essayScore}
                onChange={setEssayScore}
                min={0}
                max={100}
                suffix="점"
              />
              <InputGroup
                label="배점 단계"
                value={essaySteps}
                onChange={setEssaySteps}
                min={3}
                max={8}
                suffix="단계"
                small
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#5A6474",
                  marginBottom: "8px",
                  display: "block",
                }}
              >
                난이도 비율
              </label>
              <RatioBar ratios={essayRatios} onChange={setEssayRatios} />
            </div>
          </div>

          {/* 규칙 설정 */}
          <div
            style={{
              background: "#fff",
              borderRadius: "14px",
              padding: "22px",
              marginBottom: "20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              border: "1px solid #E8ECF1",
            }}
          >
            <h2
              style={{
                margin: "0 0 14px",
                fontSize: "17px",
                fontWeight: 800,
                color: "#1A2332",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span
                style={{
                  background: "#0EA5E9",
                  color: "#fff",
                  width: "28px",
                  height: "28px",
                  borderRadius: "8px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "14px",
                }}
              >
                ⚙
              </span>
              배점 규칙
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {RULES.map((rule) => {
                const checked = !!activeRules[rule.id];
                return (
                  <label
                    key={rule.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: `1.5px solid ${checked ? "#4361EE" : "#E4E8EF"}`,
                      background: checked ? "#F0F4FF" : "#FAFBFC",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setActiveRules((prev) => ({
                          ...prev,
                          [rule.id]: e.target.checked,
                        }))
                      }
                      style={{
                        width: "18px",
                        height: "18px",
                        marginTop: "1px",
                        accentColor: "#4361EE",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 600,
                          color: checked ? "#1A2332" : "#5A6474",
                        }}
                      >
                        {rule.label}
                      </div>
                      {rule.description && (
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#8892A0",
                            marginTop: "2px",
                          }}
                        >
                          {rule.description}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 버튼 */}
          <button
            onClick={handleGenerate}
            disabled={liveTotal !== target}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: "12px",
              border: "none",
              background:
                liveTotal === target
                  ? "linear-gradient(135deg, #4361EE, #3A56D4)"
                  : "#D9DFE8",
              color: liveTotal === target ? "#fff" : "#8892A0",
              fontSize: "16px",
              fontWeight: 700,
              cursor: liveTotal === target ? "pointer" : "not-allowed",
              transition: "all 0.2s",
              fontFamily: "'Pretendard Variable', 'Noto Sans KR', sans-serif",
              letterSpacing: "-0.3px",
              marginBottom: "8px",
            }}
          >
            {liveTotal === target
              ? "배점 생성하기"
              : `합계가 ${target}점이 되어야 합니다 (현재 ${liveTotal}점)`}
          </button>
        </div>

        {/* 결과 영역 */}
        {generated && (
          <div ref={resultRef} style={{ marginTop: "24px" }}>
            <SummaryCard
              choiceItems={choiceItems}
              essayItems={essayItems}
              target={target}
            />

            {choiceItems.length > 0 && (
              <ScoreTable items={choiceItems} label="선택형 배점표" />
            )}
            {essayItems.length > 0 && (
              <ScoreTable items={essayItems} label="서술형 배점표" />
            )}

            {/* 내보내기 버튼 */}
            <div
              className="no-print"
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                marginTop: "16px",
              }}
            >
              <button
                onClick={handleCSV}
                style={{
                  flex: 1,
                  minWidth: "140px",
                  padding: "12px 18px",
                  borderRadius: "10px",
                  border: "1.5px solid #4361EE",
                  background: "#fff",
                  color: "#4361EE",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'Pretendard Variable', 'Noto Sans KR', sans-serif",
                  transition: "all 0.2s",
                }}
              >
                📊 CSV 다운로드
              </button>
              <button
                onClick={handlePrint}
                style={{
                  flex: 1,
                  minWidth: "140px",
                  padding: "12px 18px",
                  borderRadius: "10px",
                  border: "1.5px solid #5A6474",
                  background: "#fff",
                  color: "#5A6474",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'Pretendard Variable', 'Noto Sans KR', sans-serif",
                  transition: "all 0.2s",
                }}
              >
                🖨️ 인쇄 / PDF
              </button>
              <button
                onClick={handleReset}
                style={{
                  flex: 1,
                  minWidth: "140px",
                  padding: "12px 18px",
                  borderRadius: "10px",
                  border: "1.5px solid #D9DFE8",
                  background: "#fff",
                  color: "#8892A0",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'Pretendard Variable', 'Noto Sans KR', sans-serif",
                  transition: "all 0.2s",
                }}
              >
                🔄 다시 설정
              </button>
            </div>
          </div>
        )}

        <p
          className="no-print"
          style={{
            textAlign: "center",
            fontSize: "12px",
            color: "#B0B8C4",
            marginTop: "32px",
          }}
        >
          일회성 도구 · 데이터는 저장되지 않습니다
        </p>
      </div>
    </div>
  );
}

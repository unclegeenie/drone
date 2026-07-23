"use client";

import { useEffect, useMemo, useState } from "react";
import FlightSimulator from "./FlightSimulator";

type Grade = "1" | "2";
type WeightBasis = "airframe" | "mtow";
type TrainingMode = "course" | "exam";

type Course = {
  id: string;
  label: string;
  shortLabel: string;
  detail: string;
};

const COURSES: Record<Grade, Course[]> = {
  "1": [
    {
      id: "hover",
      label: "공중 정지비행",
      shortLabel: "호버링",
      detail: "고도·위치·기수 방향을 유지하는 정지비행",
    },
    {
      id: "straight",
      label: "직진·후진",
      shortLabel: "직진·후진",
      detail: "일정한 고도와 경로로 직진 및 후진 수평비행",
    },
    {
      id: "triangle",
      label: "삼각비행",
      shortLabel: "삼각비행",
      detail: "A→B→A 상공 +7.5m→D→A를 연결하는 수직면 삼각 경로",
    },
    {
      id: "circle",
      label: "원주비행",
      shortLabel: "원주비행",
      detail: "A 중심 반경 7.5m로 H·B·C·D를 통과하는 러더턴",
    },
    {
      id: "emergency",
      label: "비상조작",
      shortLabel: "비상조작",
      detail: "H 상공에서 정지 후 좌·우 F 안전지점으로 비상착륙",
    },
    {
      id: "normal-landing",
      label: "정상접근·착륙",
      shortLabel: "정상접근",
      detail: "F에서 재이륙해 H로 수평접근 후 수행하는 정상착륙",
    },
    {
      id: "crosswind",
      label: "측풍접근·착륙",
      shortLabel: "측풍접근",
      detail: "D 또는 B에서 기수를 유지하며 H로 측풍 보정 접근",
    },
  ],
  "2": [
    {
      id: "straight",
      label: "직진·후진",
      shortLabel: "직진·후진",
      detail: "일정한 고도와 경로로 직진 및 후진 수평비행",
    },
    {
      id: "triangle",
      label: "삼각비행",
      shortLabel: "삼각비행",
      detail: "A→B→A 상공 +7.5m→D→A를 연결하는 수직면 삼각 경로",
    },
    {
      id: "diamond",
      label: "마름모비행",
      shortLabel: "마름모비행",
      detail: "H→B→C→D→H 네 기준점을 연결하는 마름모 경로",
    },
    {
      id: "crosswind",
      label: "측풍접근·착륙",
      shortLabel: "측풍접근",
      detail: "D 또는 B에서 기수를 유지하며 H로 측풍 보정 접근",
    },
  ],
};

const WEIGHT_RANGES: Record<
  Grade,
  { min: number; max: number; initial: number }
> = {
  "1": { min: 25.1, max: 150, initial: 32 },
  "2": { min: 7.1, max: 25, initial: 12 },
};

const BASIS_LABELS: Record<WeightBasis, string> = {
  airframe: "기체중량",
  mtow: "최대이륙중량",
};

const EXAM_STEPS: Record<Grade, string[]> = {
  "1": [
    "이륙비행",
    "공중 정지비행",
    "직진·후진 수평비행",
    "삼각비행",
    "원주비행",
    "비상조작",
    "정상접근·착륙",
    "측풍접근·착륙",
  ],
  "2": [
    "이륙비행",
    "직진·후진 수평비행",
    "삼각비행",
    "마름모비행",
    "측풍접근·착륙",
  ],
};

export default function Home() {
  const [grade, setGrade] = useState<Grade>("1");
  const [trainingMode, setTrainingMode] =
    useState<TrainingMode>("course");
  const [courseId, setCourseId] = useState("triangle");
  const [weightBasis, setWeightBasis] = useState<WeightBasis>("mtow");
  const [weight, setWeight] = useState(32);
  const [controller, setController] = useState<{
    connected: boolean;
    name?: string;
  }>({ connected: false });
  const [notice, setNotice] = useState<string | null>(null);
  const [isFlying, setIsFlying] = useState(false);

  const courses = COURSES[grade];
  const range = WEIGHT_RANGES[grade];
  const selectedCourse =
    courses.find((course) => course.id === courseId) ?? courses[0];
  const examSteps = EXAM_STEPS[grade];
  const activeTitle =
    trainingMode === "exam" ? `${grade}종 전체 시험` : selectedCourse.label;
  const activeDetail =
    trainingMode === "exam"
      ? `이륙부터 최종 착륙까지 ${examSteps.length}개 평가동작을 순서대로 진행합니다.`
      : selectedCourse.detail;

  const sliderProgress = useMemo(() => {
    return ((weight - range.min) / (range.max - range.min)) * 100;
  }, [range, weight]);

  useEffect(() => {
    const readController = () => {
      const gamepads = navigator.getGamepads?.() ?? [];
      const active = Array.from(gamepads).find(Boolean);
      setController(
        active
          ? { connected: true, name: active.id }
          : { connected: false },
      );
    };

    const onConnected = (event: GamepadEvent) => {
      setController({ connected: true, name: event.gamepad.id });
      setNotice("조종기가 연결되었습니다. 스틱 보정은 다음 단계에서 진행합니다.");
    };

    const onDisconnected = () => {
      readController();
      setNotice("조종기 연결이 해제되었습니다.");
    };

    readController();
    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);
    return () => {
      window.removeEventListener("gamepadconnected", onConnected);
      window.removeEventListener("gamepaddisconnected", onDisconnected);
    };
  }, []);

  const selectGrade = (nextGrade: Grade) => {
    const nextRange = WEIGHT_RANGES[nextGrade];
    setGrade(nextGrade);
    setCourseId(nextGrade === "1" ? "triangle" : "diamond");
    setWeight(nextRange.initial);
    setNotice(null);
  };

  const updateWeight = (nextValue: number) => {
    if (Number.isNaN(nextValue)) return;
    const clamped = Math.min(range.max, Math.max(range.min, nextValue));
    setWeight(Math.round(clamped * 10) / 10);
  };

  const scanController = () => {
    const gamepads = navigator.getGamepads?.() ?? [];
    const active = Array.from(gamepads).find(Boolean);
    if (active) {
      setController({ connected: true, name: active.id });
      setNotice("조종기 입력을 확인했습니다.");
      return;
    }
    setNotice(
      "USB 조종기를 연결한 뒤 조종기의 스틱이나 버튼을 한 번 움직여 주세요.",
    );
  };

  const startSimulation = () => {
    setNotice(null);
    setIsFlying(true);
  };

  if (isFlying) {
    return (
      <FlightSimulator
        grade={grade}
        trainingMode={trainingMode}
        courseId={selectedCourse.id}
        courseLabel={selectedCourse.label}
        weight={weight}
        weightBasisLabel={BASIS_LABELS[weightBasis]}
        controllerName={controller.name}
        onExit={() => {
          setIsFlying(false);
          setNotice("비행 설정 화면으로 돌아왔습니다.");
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="드론 실기 시뮬레이터">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <b />
          </span>
          <span>
            <strong>드론 실기 시뮬레이터</strong>
            <small>국가자격 실기훈련 초안</small>
          </span>
        </div>

        <div className="topbar-actions">
          <span className="field-label">가상 훈련장 01</span>
          <button
            type="button"
            className={`controller-button ${controller.connected ? "is-connected" : ""}`}
            onClick={scanController}
            aria-label={
              controller.connected
                ? `조종기 연결됨: ${controller.name}`
                : "USB 조종기 연결 확인"
            }
          >
            <span className="status-dot" aria-hidden="true" />
            {controller.connected ? "조종기 연결됨" : "조종기 연결 대기"}
          </button>
        </div>
      </header>

      <section className="training-field">
        <div className="field-shade" aria-hidden="true" />

        <form
          className="setup-panel"
          onSubmit={(event) => {
            event.preventDefault();
            startSimulation();
          }}
        >
          <div className="panel-heading">
            <span className="eyebrow">FLIGHT TRAINING SETUP</span>
            <h1>비행 훈련 설정</h1>
            <p>시험 종별과 훈련 방식, 기체 무게 기준을 선택해 주세요.</p>
          </div>

          <div className="top-settings">
            <fieldset className="setting-group compact-setting">
              <legend>
                시험 종별
                <span>{grade}종 과정</span>
              </legend>
              <div className="segmented grade-segmented">
                {(["1", "2"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={grade === item ? "is-active" : ""}
                    onClick={() => selectGrade(item)}
                    aria-pressed={grade === item}
                  >
                    <strong>{item}종</strong>
                    <small>
                      {item === "1" ? "25kg 초과급" : "7–25kg급"}
                    </small>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="setting-group compact-setting">
              <legend>
                훈련 방식
                <span>{trainingMode === "course" ? "연습" : "시험"}</span>
              </legend>
              <div className="segmented mode-segmented">
                <button
                  type="button"
                  className={trainingMode === "course" ? "is-active" : ""}
                  onClick={() => {
                    setTrainingMode("course");
                    setNotice(null);
                  }}
                  aria-pressed={trainingMode === "course"}
                >
                  코스별 연습
                </button>
                <button
                  type="button"
                  className={trainingMode === "exam" ? "is-active" : ""}
                  onClick={() => {
                    setTrainingMode("exam");
                    setNotice(null);
                  }}
                  aria-pressed={trainingMode === "exam"}
                >
                  전체 시험
                </button>
              </div>
            </fieldset>
          </div>

          <fieldset className="setting-group">
            <legend>
              {trainingMode === "course" ? "코스 선택" : "전체 시험 순서"}
              <span>
                {trainingMode === "course"
                  ? `${courses.length}개 코스`
                  : `${examSteps.length}개 평가동작`}
              </span>
            </legend>
            {trainingMode === "course" ? (
              <>
                <div className="course-grid">
                  {courses.map((course) => (
                    <button
                      key={course.id}
                      type="button"
                      className={courseId === course.id ? "is-active" : ""}
                      onClick={() => {
                        setCourseId(course.id);
                        setNotice(null);
                      }}
                      aria-pressed={courseId === course.id}
                      title={course.detail}
                    >
                      <span className="course-check" aria-hidden="true">
                        ✓
                      </span>
                      {course.label}
                    </button>
                  ))}
                </div>
                <p className="common-procedure">
                  <span aria-hidden="true">＋</span>
                  공통 이륙비행 절차가 종합훈련에 포함됩니다.
                </p>
              </>
            ) : (
              <>
                <ol className="exam-sequence">
                  {examSteps.map((step, index) => (
                    <li key={step}>
                      <b>{index + 1}</b>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="common-procedure exam-note">
                  <span aria-hidden="true">✓</span>
                  모든 평가동작을 순서대로 이어서 진행합니다.
                </p>
              </>
            )}
          </fieldset>

          <fieldset className="setting-group weight-group">
            <legend>
              기체 무게 설정
              <span>단위 kg</span>
            </legend>

            <div className="segmented basis-segmented">
              {(["airframe", "mtow"] as const).map((basis) => (
                <button
                  key={basis}
                  type="button"
                  className={weightBasis === basis ? "is-active" : ""}
                  onClick={() => {
                    setWeightBasis(basis);
                    setNotice(null);
                  }}
                  aria-pressed={weightBasis === basis}
                >
                  {BASIS_LABELS[basis]}
                </button>
              ))}
            </div>

            <div className="weight-input-row">
              <label htmlFor="aircraft-weight">
                {BASIS_LABELS[weightBasis]} 입력
              </label>
              <div className="number-field">
                <input
                  id="aircraft-weight"
                  type="number"
                  min={range.min}
                  max={range.max}
                  step="0.1"
                  value={weight}
                  onChange={(event) => updateWeight(Number(event.target.value))}
                  aria-describedby="weight-help"
                />
                <span>kg</span>
              </div>
            </div>

            <div className="range-wrap">
              <input
                type="range"
                min={range.min}
                max={range.max}
                step="0.1"
                value={weight}
                onChange={(event) => updateWeight(Number(event.target.value))}
                aria-label={`${BASIS_LABELS[weightBasis]} 슬라이더`}
                style={{
                  background: `linear-gradient(90deg, #ffd24a 0%, #ffd24a ${sliderProgress}%, rgba(255,255,255,.18) ${sliderProgress}%, rgba(255,255,255,.18) 100%)`,
                }}
              />
              <div className="range-labels" aria-hidden="true">
                <span>{range.min.toFixed(1)} kg</span>
                <span>{range.max.toFixed(0)} kg</span>
              </div>
            </div>
            <p id="weight-help" className="weight-help">
              종별은 직접 선택하며, 입력값은 비행물리 설정에 사용됩니다.
            </p>
          </fieldset>

          <div className="selection-summary" aria-live="polite">
            <span>선택 요약</span>
            <strong>
              {grade}종 <i>·</i>{" "}
              {trainingMode === "exam" ? "전체 시험" : selectedCourse.label}{" "}
              <i>·</i>{" "}
              {BASIS_LABELS[weightBasis]}{" "}
              <em>{weight.toFixed(1)} kg</em>
            </strong>
          </div>

          <button className="start-button" type="submit">
            <span className="play-icon" aria-hidden="true">
              ▶
            </span>
            {trainingMode === "exam" ? "전체 시험 시작" : "코스 연습 시작"}
            <span className="button-arrow" aria-hidden="true">
              →
            </span>
          </button>
        </form>

        <aside className="course-status" aria-label="현재 훈련 설정">
          <div className="status-kicker">
            <span className="live-dot" aria-hidden="true" />
            {trainingMode === "exam" ? "EXAM READY" : "COURSE READY"}
          </div>
          <h2>{activeTitle}</h2>
          <p>{activeDetail}</p>
          <dl>
            <div>
              <dt>종별</dt>
              <dd>{grade}종</dd>
            </div>
            <div>
              <dt>훈련 방식</dt>
              <dd>{trainingMode === "exam" ? "전체 시험" : "코스별 연습"}</dd>
            </div>
            <div>
              <dt>중량 기준</dt>
              <dd>{BASIS_LABELS[weightBasis]}</dd>
            </div>
            <div>
              <dt>설정 중량</dt>
              <dd>{weight.toFixed(1)} kg</dd>
            </div>
          </dl>
        </aside>

        {notice && (
          <div className="toast" role="status" aria-live="polite">
            <span aria-hidden="true">✓</span>
            <p>{notice}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="알림 닫기"
            >
              ×
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

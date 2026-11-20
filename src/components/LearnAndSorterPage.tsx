import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Camera, CheckCircle2, Sparkles, Upload, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  AiClassificationResult,
  AppRoute,
  LearningModuleForUser,
} from '../types/kiln';
import { formatDateTime, readImageFileAsDataUrl } from '../lib/status-labels';

interface LearnAndSorterPageProps {
  onNavigate: (route: AppRoute, hash?: string) => void;
}

type ToolTab = 'sorter' | 'learn';

interface QuizGradingFeedback {
  moduleId: number;
  scorePercent: number;
  correctCount: number;
  totalQuestions: number;
  passed: boolean;
  bonusAwardedPoints: string;
  alreadyCreditedPreviously: boolean;
  review: Array<{
    questionId: string;
    selectedIndex: number;
    correctIndex: number;
    isCorrect: boolean;
    explanation: string;
  }>;
}

export function LearnAndSorterPage({ onNavigate }: LearnAndSorterPageProps) {
  const { user, loading: authLoading, authFetch, refreshUser } = useAuth();

  const [tab, setTab] = useState<ToolTab>('sorter');

  // AI Waste Sorter state
  const [description, setDescription] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [latestResult, setLatestResult] = useState<AiClassificationResult | null>(null);
  const [history, setHistory] = useState<
    Array<{
      id: number;
      inputSummary: string;
      suggestedCategoryName: string;
      confidenceScore: number | null;
      isAcceptedMaterial: boolean;
      providerUsed: string;
      createdAt: string;
    }>
  >([]);

  // Learn & Earn state
  const [modules, setModules] = useState<LearningModuleForUser[]>([]);
  const [activeModuleId, setActiveModuleId] = useState<number | null>(null);
  const [languageMode, setLanguageMode] = useState<'en' | 'pidgin'>('en');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [quizFeedback, setQuizFeedback] = useState<QuizGradingFeedback | null>(null);

  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      onNavigate('/login');
    }
  }, [authLoading, user, onNavigate]);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    setError(null);
    try {
      const [hRes, mRes] = await Promise.all([
        authFetch('/api/ai-sorter/history'),
        authFetch('/api/learning/modules'),
      ]);
      const [hData, mData] = await Promise.all([
        hRes.ok ? hRes.json() : Promise.resolve({ history: [] }),
        mRes.ok ? mRes.json() : Promise.resolve({ modules: [] }),
      ]);
      setHistory(Array.isArray(hData.history) ? hData.history : []);
      const mods: LearningModuleForUser[] = Array.isArray(mData.modules) ? mData.modules : [];
      setModules(mods);
      if (mods.length > 0 && activeModuleId === null) {
        setActiveModuleId(mods[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load tools.');
    } finally {
      setLoadingData(false);
    }
  }, [authFetch, activeModuleId]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, loadData]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setImageDataUrl(dataUrl);
      setImageName(file.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to read image.');
    }
  }

  async function handleClassify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setClassifying(true);
    try {
      const res = await authFetch('/api/ai-sorter/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textDescription: description,
          imageDataUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Classification request failed.');
      setLatestResult(data.classification);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to classify waste.');
    } finally {
      setClassifying(false);
    }
  }

  const activeModule = modules.find((m) => m.id === activeModuleId) ?? null;

  async function handleSubmitQuiz(e: React.FormEvent) {
    e.preventDefault();
    if (!activeModule) return;
    setError(null);
    setSubmittingQuiz(true);
    try {
      const orderedAnswers = activeModule.questions.map((q) => answers[q.id]);
      if (orderedAnswers.some((v) => v === undefined)) {
        throw new Error('Please answer every quiz question before submitting.');
      }
      const res = await authFetch(`/api/learning/modules/${activeModule.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: orderedAnswers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Quiz grading failed.');
      setQuizFeedback({
        moduleId: activeModule.id,
        ...data.result,
      });
      await Promise.all([loadData(), refreshUser()]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to grade quiz.');
    } finally {
      setSubmittingQuiz(false);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <p className="text-sm text-[#59605B]">Loading AI Waste Sorter &amp; Learn and Earn...</p>
      </main>
    );
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#DAD7CE]">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[#59605B]">
            Sorting Guidance &amp; Community Education
          </p>
          <h1 className="mt-1.5 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#171B19]">
            AI Waste Sorter &amp; Learn and Earn
          </h1>
          <p className="mt-1 text-sm text-[#59605B]">
            Check how to prepare recyclables before pickup, or complete short lessons in English or
            Nigerian Pidgin to earn learning bonus points.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('/collections')}
          className="min-h-[44px] px-4 py-2 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer self-start md:self-auto"
        >
          Request Collection
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-5 p-3.5 text-sm text-[#7F2315] bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm"
        >
          {error}
        </div>
      )}

      {/* Top Mode Switch */}
      <div className="mt-6 flex flex-wrap gap-2 border-b border-[#DAD7CE] pb-3">
        <button
          type="button"
          onClick={() => setTab('sorter')}
          className={`min-h-[44px] px-4 py-2 text-sm font-medium rounded-sm inline-flex items-center gap-2 cursor-pointer ${
            tab === 'sorter'
              ? 'bg-[#17372D] text-[#F7F6F2]'
              : 'bg-white border border-[#DAD7CE] text-[#3F4541] hover:bg-[#EFECE4]'
          }`}
        >
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          <span>AI Waste Sorter (Advisory)</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('learn')}
          className={`min-h-[44px] px-4 py-2 text-sm font-medium rounded-sm inline-flex items-center gap-2 cursor-pointer ${
            tab === 'learn'
              ? 'bg-[#17372D] text-[#F7F6F2]'
              : 'bg-white border border-[#DAD7CE] text-[#3F4541] hover:bg-[#EFECE4]'
          }`}
        >
          <BookOpen className="w-4 h-4" aria-hidden="true" />
          <span>Learn &amp; Earn Modules ({modules.length})</span>
        </button>
      </div>

      {/* TAB A: AI WASTE SORTER */}
      {tab === 'sorter' && (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <section className="lg:col-span-6 bg-white border border-[#DAD7CE] rounded-sm p-6">
            <h2 className="font-display text-xl font-semibold text-[#171B19]">
              Check Your Recyclable Material
            </h2>
            <p className="mt-1 text-sm text-[#59605B]">
              Upload a photograph or describe your waste item to see whether KILN currently accepts
              it and how to prepare it before weighing.
            </p>

            <form onSubmit={handleClassify} className="mt-5 space-y-4">
              <div>
                <label htmlFor="ai-desc" className="block text-sm font-medium text-[#171B19]">
                  Describe the item(s)
                </label>
                <textarea
                  id="ai-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Empty clear plastic water bottles rinsed and flattened, or dry brown delivery cartons..."
                  className="mt-1.5 w-full px-3.5 py-2.5 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-[#171B19]">
                  Optional photograph (JPEG, PNG, WebP · max 2 MB)
                </span>
                <div className="mt-1.5 flex items-center gap-3">
                  <label className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#17372D] border border-[#17372D] bg-[#F7F6F2] hover:bg-[#EFECE4] rounded-sm inline-flex items-center gap-2 cursor-pointer">
                    <Upload className="w-4 h-4" aria-hidden="true" />
                    <span>{imageDataUrl ? 'Change Photo' : 'Upload Photo'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileSelect}
                      className="sr-only"
                    />
                  </label>
                  {imageDataUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setImageDataUrl(null);
                        setImageName(null);
                      }}
                      className="min-h-[40px] px-3 py-1.5 text-xs text-[#991B1B] border border-[#E6B8B0] rounded-sm inline-flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Remove ({imageName})</span>
                    </button>
                  )}
                </div>
                {imageDataUrl && (
                  <img
                    src={imageDataUrl}
                    alt="Uploaded item preview"
                    className="mt-3 max-h-48 rounded-sm border border-[#DAD7CE] object-contain"
                  />
                )}
              </div>

              <button
                type="submit"
                disabled={classifying || (!description.trim() && !imageDataUrl)}
                className="min-h-[44px] px-6 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] disabled:opacity-60 rounded-sm inline-flex items-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>{classifying ? 'Analyzing Material...' : 'Classify Material'}</span>
              </button>
            </form>

            <div className="mt-5 pt-4 border-t border-[#E5E2D9] text-xs text-[#59605B]">
              <strong>Advisory Notice:</strong> AI waste sorting provides preparation guidance only.
              It does not approve collections, confirm physical weight, or credit reward points.
            </div>
          </section>

          <section className="lg:col-span-6 space-y-6">
            {latestResult ? (
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5E2D9]">
                  <div>
                    <p className="text-xs font-mono text-[#59605B] uppercase">
                      Suggested Category
                    </p>
                    <h3 className="font-display text-2xl font-semibold text-[#171B19]">
                      {latestResult.suggestedCategoryName}
                    </h3>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold ${
                        latestResult.isAcceptedMaterial && !latestResult.isUncertain
                          ? 'text-[#14532D]'
                          : 'text-[#8A4E11]'
                      }`}
                    >
                      {latestResult.isUncertain
                        ? 'Uncertain — Needs Inspection'
                        : latestResult.isAcceptedMaterial
                          ? 'Accepted by KILN'
                          : 'Not Currently Accepted'}
                    </p>
                    <p className="text-xs font-mono text-[#59605B] tabular-nums">
                      Confidence: {latestResult.confidenceScore}%
                      {latestResult.fallbackUsed ? ' (Rule Fallback)' : ''}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[#59605B]">
                    Preparation &amp; Sorting Guidance
                  </h4>
                  <p className="mt-1 text-sm text-[#171B19] leading-relaxed">
                    {latestResult.preparationGuidance}
                  </p>
                </div>

                {latestResult.contaminationWarning && (
                  <div className="p-3.5 bg-[#FDF8EE] border border-[#DFC79F] rounded-sm text-sm text-[#7A430D]">
                    <strong>Contamination Check:</strong> {latestResult.contaminationWarning}
                  </div>
                )}

                <div className="p-3.5 bg-[#F7F6F2] border border-[#DAD7CE] rounded-sm text-sm text-[#3F4541]">
                  <span className="text-xs font-semibold uppercase text-[#59605B] block mb-1">
                    Nigerian Pidgin Summary
                  </span>
                  {latestResult.pidginSummary}
                </div>

                <p className="text-xs text-[#59605B]">{latestResult.disclaimer}</p>

                {latestResult.isAcceptedMaterial && (
                  <button
                    type="button"
                    onClick={() => onNavigate('/collections')}
                    className="min-h-[44px] px-4 py-2 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer"
                  >
                    Start Collection Request for This Material
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-[#EFECE4] border border-[#DAD7CE] rounded-sm p-6 text-sm text-[#3F4541]">
                <h3 className="font-display text-lg font-semibold text-[#171B19]">
                  Supported Pilot Materials
                </h3>
                <p className="mt-2">
                  KILN currently accepts <strong>Plastic Bottles (PET)</strong>,{' '}
                  <strong>Aluminium Cans</strong>, <strong>Paper</strong>, and{' '}
                  <strong>Cardboard</strong>. Describe an item or upload a photo to receive sorting
                  and contamination guidance.
                </p>
              </div>
            )}

            {/* Recent Classification History */}
            <div className="bg-white border border-[#DAD7CE] rounded-sm">
              <div className="p-4 border-b border-[#E5E2D9]">
                <h3 className="font-display text-lg font-semibold text-[#171B19]">
                  Recent Sorting Checks
                </h3>
              </div>
              {loadingData ? (
                <p className="p-4 text-sm text-[#59605B]">Loading history...</p>
              ) : history.length === 0 ? (
                <p className="p-4 text-sm text-[#59605B]">
                  No sorting checks yet. Your advisory checks will appear here.
                </p>
              ) : (
                <div className="divide-y divide-[#E5E2D9]">
                  {history.slice(0, 6).map((item) => (
                    <div key={item.id} className="p-4 flex items-center justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium text-[#171B19]">{item.suggestedCategoryName}</p>
                        <p className="text-xs text-[#59605B] line-clamp-1">{item.inputSummary}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`text-xs font-semibold ${
                            item.isAcceptedMaterial ? 'text-[#14532D]' : 'text-[#8A4E11]'
                          }`}
                        >
                          {item.isAcceptedMaterial ? 'Accepted' : 'Review'}
                        </p>
                        <p className="text-xs font-mono text-[#59605B]">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* TAB B: LEARN & EARN */}
      {tab === 'learn' && (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Module List */}
          <aside className="lg:col-span-4 space-y-3">
            {loadingData ? (
              <p className="text-sm text-[#59605B]">Loading modules...</p>
            ) : modules.length === 0 ? (
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5 text-sm text-[#59605B]">
                No learning modules are currently active.
              </div>
            ) : (
              modules.map((mod) => {
                const selected = mod.id === activeModuleId;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => {
                      setActiveModuleId(mod.id);
                      setAnswers({});
                      setQuizFeedback(null);
                      setError(null);
                    }}
                    className={`w-full text-left p-4 rounded-sm border transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#17372D] text-[#F7F6F2] border-[#17372D]'
                        : 'bg-white text-[#171B19] border-[#DAD7CE] hover:bg-[#EFECE4]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-mono">
                      <span className={selected ? 'text-[#D6E4DD]' : 'text-[#59605B]'}>
                        {mod.topic}
                      </span>
                      <span className={selected ? 'text-[#F7F6F2]' : 'text-[#17372D] font-semibold'}>
                        +{mod.bonusPoints} pts{mod.isDemo ? ' [DEMO]' : ''}
                      </span>
                    </div>
                    <p className="mt-1.5 font-display text-base font-semibold">{mod.title}</p>
                    <p className={`mt-1 text-xs ${selected ? 'text-[#D6E4DD]' : 'text-[#59605B]'}`}>
                      {mod.completion?.passed
                        ? `Completed (${mod.completion.bestScorePercent}%) · Bonus Credited`
                        : mod.completion
                          ? `Best attempt: ${mod.completion.bestScorePercent}% · Pass >= ${mod.passingScorePercent}%`
                          : `Pass >= ${mod.passingScorePercent}% to earn bonus`}
                    </p>
                  </button>
                );
              })
            )}
          </aside>

          {/* Active Module Lesson + Quiz */}
          <section className="lg:col-span-8">
            {!activeModule ? (
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 text-sm text-[#59605B]">
                Select a learning module to start reading and complete the quiz.
              </div>
            ) : (
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 sm:p-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-[#E5E2D9]">
                  <div>
                    <p className="text-xs font-mono text-[#59605B]">
                      {activeModule.topic} · Pass score: {activeModule.passingScorePercent}% ·
                      One-time bonus: +{activeModule.bonusPoints} pts
                      {activeModule.isDemo ? ' (DEMO)' : ''}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-semibold text-[#171B19]">
                      {activeModule.title}
                    </h2>
                    <p className="mt-1 text-sm text-[#59605B]">{activeModule.summary}</p>
                  </div>

                  {activeModule.contentPidgin && (
                    <div className="flex items-center border border-[#C9C5BA] rounded-sm overflow-hidden shrink-0 self-start">
                      <button
                        type="button"
                        onClick={() => setLanguageMode('en')}
                        className={`px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                          languageMode === 'en'
                            ? 'bg-[#17372D] text-[#F7F6F2]'
                            : 'bg-[#F7F6F2] text-[#3F4541]'
                        }`}
                      >
                        English
                      </button>
                      <button
                        type="button"
                        onClick={() => setLanguageMode('pidgin')}
                        className={`px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                          languageMode === 'pidgin'
                            ? 'bg-[#17372D] text-[#F7F6F2]'
                            : 'bg-[#F7F6F2] text-[#3F4541]'
                        }`}
                      >
                        Nigerian Pidgin
                      </button>
                    </div>
                  )}
                </div>

                {/* Lesson Content */}
                <div className="p-5 bg-[#F7F6F2] border border-[#E5E2D9] rounded-sm text-sm leading-relaxed text-[#171B19] whitespace-pre-line">
                  {languageMode === 'pidgin' && activeModule.contentPidgin
                    ? activeModule.contentPidgin
                    : activeModule.contentEnglish}
                </div>

                {activeModule.completion?.passed && (
                  <div className="p-4 bg-[#EEF4F0] border border-[#B7CEC0] rounded-sm text-sm text-[#17372D] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      You have already completed this module (best score:{' '}
                      {activeModule.completion.bestScorePercent}%). Your one-time learning bonus has
                      been credited to your wallet. You can still review or retake for practice.
                    </span>
                  </div>
                )}

                {/* Quiz Feedback Banner */}
                {quizFeedback && quizFeedback.moduleId === activeModule.id && (
                  <div
                    role="status"
                    className={`p-4 rounded-sm border text-sm space-y-2 ${
                      quizFeedback.passed
                        ? 'bg-[#EEF4F0] border-[#B7CEC0] text-[#17372D]'
                        : 'bg-[#FDF8EE] border-[#DFC79F] text-[#7A430D]'
                    }`}
                  >
                    <p className="font-semibold">
                      Score: {quizFeedback.scorePercent}% ({quizFeedback.correctCount} /{' '}
                      {quizFeedback.totalQuestions} correct) —{' '}
                      {quizFeedback.passed ? 'Passed' : 'Not Passed Yet'}
                    </p>
                    {quizFeedback.passed && Number(quizFeedback.bonusAwardedPoints) > 0 && (
                      <p>
                        <strong>+{quizFeedback.bonusAwardedPoints} pts</strong> credited to your
                        reward wallet ledger!
                      </p>
                    )}
                    {quizFeedback.passed && quizFeedback.alreadyCreditedPreviously && (
                      <p>
                        Passed again! Your learning bonus for this module was already credited on a
                        previous passing attempt (no duplicate bonus issued).
                      </p>
                    )}
                  </div>
                )}

                {/* Quiz Questions */}
                <form onSubmit={handleSubmitQuiz} className="space-y-6">
                  <h3 className="font-display text-lg font-semibold text-[#171B19]">
                    Knowledge Check ({activeModule.questions.length} Questions)
                  </h3>

                  {activeModule.questions.map((q, qIdx) => {
                    const reviewItem =
                      quizFeedback?.moduleId === activeModule.id
                        ? quizFeedback.review.find((r) => r.questionId === q.id)
                        : null;
                    return (
                      <fieldset
                        key={q.id}
                        className="p-4 border border-[#DAD7CE] rounded-sm space-y-2.5"
                      >
                        <legend className="text-sm font-semibold text-[#171B19] px-1">
                          {qIdx + 1}. {q.prompt}
                        </legend>
                        <div className="space-y-2">
                          {q.options.map((opt, optIdx) => (
                            <label
                              key={optIdx}
                              className="flex items-start gap-2.5 p-2 rounded-sm hover:bg-[#F7F6F2] cursor-pointer text-sm text-[#3F4541]"
                            >
                              <input
                                type="radio"
                                name={`quiz-${activeModule.id}-${q.id}`}
                                checked={answers[q.id] === optIdx}
                                onChange={() =>
                                  setAnswers((prev) => ({ ...prev, [q.id]: optIdx }))
                                }
                                className="mt-1 h-4 w-4 accent-[#17372D]"
                              />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </div>
                        {reviewItem && (
                          <p
                            className={`text-xs pt-2 border-t border-[#E5E2D9] ${
                              reviewItem.isCorrect ? 'text-[#14532D]' : 'text-[#991B1B]'
                            }`}
                          >
                            <strong>{reviewItem.isCorrect ? 'Correct:' : 'Review:'}</strong>{' '}
                            {reviewItem.explanation}
                          </p>
                        )}
                      </fieldset>
                    );
                  })}

                  <button
                    type="submit"
                    disabled={submittingQuiz}
                    className="min-h-[44px] px-6 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] disabled:opacity-60 rounded-sm cursor-pointer"
                  >
                    {submittingQuiz ? 'Grading Answers...' : 'Submit Quiz Answers'}
                  </button>
                </form>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
